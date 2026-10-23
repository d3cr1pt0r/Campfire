// Campfire's PipeWire bridge. No Node ABI or third-party capture library is
// required.
#define _GNU_SOURCE
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <pipewire/impl.h>
#include <pipewire/pipewire.h>
#include <signal.h>
#include <spa/utils/defs.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <unistd.h>

struct node {
  struct node *next;
  uint32_t id;
  struct pw_node *proxy;
  struct spa_hook listener;
  struct pw_properties *props;
};
struct port {
  struct port *next;
  uint32_t id, node;
  bool input;
  char channel[16];
};
struct link {
  struct link *next;
  uint32_t output, input;
  struct pw_proxy *proxy;
};
struct bridge {
  struct pw_main_loop *loop;
  struct pw_context *context;
  struct pw_core *core;
  struct pw_registry *registry;
  struct spa_hook core_listener, registry_listener;
  struct pw_impl_module *module;
  struct node *nodes;
  struct port *ports;
  struct link *links;
  struct spa_source *timer;
  int seq, stage, status;
  pid_t excluded_pid, target_pid;
  unsigned long window;
  char *application, *name;
  char capture_name[160];
  bool listing, initialized, ready;
};
static const char *property(const struct node *node, const char *key) {
  const char *value = pw_properties_get(node->props, key);
  return value ? value : "";
}
static void json_string(const char *text) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)text; *p; p++) {
    if (*p == '"' || *p == '\\')
      printf("\\%c", *p);
    else if (*p < 32)
      printf("\\u%04x", *p);
    else
      putchar(*p);
  }
  putchar('"');
}
static bool descendant(pid_t pid, pid_t parent) {
  for (int depth = 0; pid > 1 && depth < 64; depth++) {
    if (pid == parent)
      return true;
    char path[64], line[4096];
    snprintf(path, sizeof(path), "/proc/%ld/stat", (long)pid);
    FILE *file = fopen(path, "r");
    if (!file)
      break;
    char *read = fgets(line, sizeof(line), file);
    fclose(file);
    char *end = read ? strrchr(line, ')') : NULL;
    long next;
    char state;
    if (!end || sscanf(end + 1, " %c %ld", &state, &next) != 2 || next == pid)
      break;
    pid = (pid_t)next;
  }
  return false;
}
static bool application_node(struct bridge *bridge, const struct node *node) {
  if (strcmp(property(node, PW_KEY_MEDIA_CLASS), "Stream/Output/Audio") != 0)
    return false;
  const char *name = property(node, PW_KEY_APP_NAME);
  const char *binary = property(node, PW_KEY_APP_PROCESS_BINARY);
  if (!strcasecmp(name, "campfire") || !strcasecmp(binary, "campfire"))
    return false;
  pid_t pid = (pid_t)strtol(property(node, PW_KEY_APP_PROCESS_ID), NULL, 10);
  return !pid || !descendant(pid, bridge->excluded_pid);
}
static struct node *find_node(struct bridge *bridge, uint32_t id) {
  for (struct node *node = bridge->nodes; node; node = node->next)
    if (node->id == id)
      return node;
  return NULL;
}
static bool chosen(struct bridge *bridge, struct node *node) {
  if (!node || !application_node(bridge, node))
    return false;
  if (!strcmp(bridge->application, "system"))
    return true;
  if (bridge->target_pid > 0)
    return strtol(property(node, PW_KEY_APP_PROCESS_ID), NULL, 10) ==
           bridge->target_pid;
  return !strcmp(property(node, PW_KEY_OBJECT_SERIAL), bridge->application);
}
static void remove_links(struct bridge *bridge, uint32_t port) {
  struct link **cursor = &bridge->links;
  while (*cursor) {
    struct link *link = *cursor;
    if (port == SPA_ID_INVALID || link->input == port || link->output == port) {
      *cursor = link->next;
      pw_proxy_destroy(link->proxy);
      free(link);
    } else
      cursor = &link->next;
  }
}
static void reconcile(void *data, uint64_t expirations) {
  (void)expirations;
  struct bridge *bridge = data;
  struct node *capture = NULL, *source = NULL;
  for (struct node *node = bridge->nodes; node; node = node->next) {
    if (!strcmp(property(node, PW_KEY_NODE_NAME), bridge->capture_name))
      capture = node;
    if (!strcmp(property(node, PW_KEY_NODE_NAME), bridge->name))
      source = node;
  }
  if (!capture || !source)
    return;
  for (struct port *output = bridge->ports; output; output = output->next) {
    if (output->input || !chosen(bridge, find_node(bridge, output->node)))
      continue;
    for (struct port *input = bridge->ports; input; input = input->next) {
      if (!input->input || input->node != capture->id)
        continue;
      bool mono = !strcmp(output->channel, "MONO");
      if (strcmp(output->channel, input->channel) &&
          !(mono &&
            (!strcmp(input->channel, "FL") || !strcmp(input->channel, "FR"))))
        continue;
      bool exists = false;
      for (struct link *link = bridge->links; link; link = link->next)
        if (link->input == input->id && link->output == output->id)
          exists = true;
      if (exists)
        continue;
      struct pw_properties *props = pw_properties_new(NULL, NULL);
      pw_properties_setf(props, PW_KEY_LINK_OUTPUT_NODE, "%u", output->node);
      pw_properties_setf(props, PW_KEY_LINK_OUTPUT_PORT, "%u", output->id);
      pw_properties_setf(props, PW_KEY_LINK_INPUT_NODE, "%u", input->node);
      pw_properties_setf(props, PW_KEY_LINK_INPUT_PORT, "%u", input->id);
      pw_properties_set(props, PW_KEY_OBJECT_LINGER, "false");
      struct pw_proxy *proxy = pw_core_create_object(
          bridge->core, "link-factory", PW_TYPE_INTERFACE_Link, PW_VERSION_LINK,
          &props->dict, 0);
      pw_properties_free(props);
      if (proxy) {
        struct link *link = calloc(1, sizeof(*link));
        if (!link) {
          pw_proxy_destroy(proxy);
          continue;
        }
        *link = (struct link){.next = bridge->links,
                              .output = output->id,
                              .input = input->id,
                              .proxy = proxy};
        bridge->links = link;
      }
    }
  }
  if (!bridge->ready) {
    bridge->ready = true;
    printf("{\"event\":\"ready\",\"name\":");
    json_string(bridge->name);
    puts("}");
    fflush(stdout);
  }
}
static void node_info(void *data, const struct pw_node_info *info) {
  struct node *node = data;
  if (info->props)
    pw_properties_update(node->props, info->props);
}
static const struct pw_node_events node_events = {PW_VERSION_NODE_EVENTS,
                                                  .info = node_info};
static void global(void *data, uint32_t id, uint32_t permissions,
                   const char *type, uint32_t version,
                   const struct spa_dict *props) {
  (void)permissions;
  struct bridge *bridge = data;
  if (!strcmp(type, PW_TYPE_INTERFACE_Node)) {
    struct node *node = calloc(1, sizeof(*node));
    if (!node)
      return;
    node->id = id;
    node->props =
        props ? pw_properties_new_dict(props) : pw_properties_new(NULL, NULL);
    node->proxy =
        pw_registry_bind(bridge->registry, id, type,
                         SPA_MIN(version, (uint32_t)PW_VERSION_NODE), 0);
    if (!node->proxy) {
      pw_properties_free(node->props);
      free(node);
      return;
    }
    node->next = bridge->nodes;
    bridge->nodes = node;
    pw_node_add_listener(node->proxy, &node->listener, &node_events, node);
  } else if (props && !strcmp(type, PW_TYPE_INTERFACE_Port)) {
    const char *node_id = spa_dict_lookup(props, PW_KEY_NODE_ID);
    const char *direction = spa_dict_lookup(props, PW_KEY_PORT_DIRECTION);
    const char *channel = spa_dict_lookup(props, PW_KEY_AUDIO_CHANNEL);
    if (!node_id || !direction || !channel)
      return;
    struct port *port = calloc(1, sizeof(*port));
    if (!port)
      return;
    *port = (struct port){.next = bridge->ports,
                          .id = id,
                          .node = (uint32_t)strtoul(node_id, NULL, 10),
                          .input = !strcmp(direction, "in")};
    snprintf(port->channel, sizeof(port->channel), "%s", channel);
    bridge->ports = port;
  }
}
static void global_remove(void *data, uint32_t id) {
  struct bridge *bridge = data;
  struct port **port = &bridge->ports;
  while (*port) {
    if ((*port)->id == id) {
      struct port *removed = *port;
      *port = removed->next;
      remove_links(bridge, id);
      free(removed);
      break;
    }
    port = &(*port)->next;
  }
  struct node **node = &bridge->nodes;
  while (*node) {
    if ((*node)->id == id) {
      struct node *removed = *node;
      *node = removed->next;
      spa_hook_remove(&removed->listener);
      pw_proxy_destroy((struct pw_proxy *)removed->proxy);
      pw_properties_free(removed->props);
      free(removed);
      break;
    }
    node = &(*node)->next;
  }
}
static const struct pw_registry_events registry_events = {
    PW_VERSION_REGISTRY_EVENTS, .global = global,
    .global_remove = global_remove};
static unsigned long window_pid(unsigned long window) {
  if (!window)
    return 0;
  Display *display = XOpenDisplay(NULL);
  if (!display)
    return 0;
  Atom atom = XInternAtom(display, "_NET_WM_PID", True), actual;
  unsigned char *value = NULL;
  unsigned long count, remaining, pid = 0;
  int format;
  if (atom != None &&
      XGetWindowProperty(display, window, atom, 0, 1, False, XA_CARDINAL,
                         &actual, &format, &count, &remaining,
                         &value) == Success &&
      actual == XA_CARDINAL && format == 32 && count)
    pid = *(unsigned long *)value;
  if (value)
    XFree(value);
  XCloseDisplay(display);
  return pid;
}
static int ignore_x_error(Display *display, XErrorEvent *event) {
  (void)display;
  (void)event;
  return 0;
}
static void done(void *data, uint32_t id, int seq) {
  struct bridge *bridge = data;
  if (id != PW_ID_CORE || seq != bridge->seq || bridge->initialized)
    return;
  if (bridge->stage++ == 0) {
    bridge->seq = pw_core_sync(bridge->core, PW_ID_CORE, seq);
    return;
  }
  bridge->initialized = true;
  if (bridge->listing) {
    printf("{\"windowPid\":%lu,\"applications\":[", window_pid(bridge->window));
    bool first = true;
    for (struct node *node = bridge->nodes; node; node = node->next) {
      if (!application_node(bridge, node))
        continue;
      if (!first)
        putchar(',');
      first = false;
      printf("{\"id\":");
      json_string(property(node, PW_KEY_OBJECT_SERIAL));
      printf(",\"pid\":");
      json_string(property(node, PW_KEY_APP_PROCESS_ID));
      printf(",\"name\":");
      const char *name = property(node, PW_KEY_APP_NAME);
      if (!*name)
        name = property(node, PW_KEY_NODE_DESCRIPTION);
      if (!*name)
        name = property(node, PW_KEY_NODE_NAME);
      json_string(name);
      putchar('}');
    }
    puts("]}");
    fflush(stdout);
    pw_main_loop_quit(bridge->loop);
    return;
  }
  if (strcmp(bridge->application, "system")) {
    bool found = false;
    for (struct node *node = bridge->nodes; node; node = node->next)
      if (application_node(bridge, node) &&
          !strcmp(property(node, PW_KEY_OBJECT_SERIAL), bridge->application)) {
        bridge->target_pid =
            (pid_t)strtol(property(node, PW_KEY_APP_PROCESS_ID), NULL, 10);
        found = true;
        break;
      }
    if (!found) {
      fprintf(stderr, "Selected application is no longer producing audio.\n");
      bridge->status = 1;
      pw_main_loop_quit(bridge->loop);
      return;
    }
  }
  char config[2048];
  // Capture discrete channels, then let PipeWire downmix to the stereo virtual
  // source.
  snprintf(config, sizeof(config),
           "audio.position = [ FL FR ] capture.props = { node.name = %s "
           "node.description = \"Campfire audio tap\" "
           "audio.position = [ FL FR FC LFE RL RR SL SR ] node.autoconnect = "
           "false node.dont-reconnect = true } "
           "playback.props = { node.name = %s node.description = %s "
           "media.class = Audio/Source node.virtual = true "
           "audio.position = [ FL FR ] node.autoconnect = false "
           "priority.session = 0 }",
           bridge->capture_name, bridge->name, bridge->name);
  bridge->module = pw_context_load_module(
      bridge->context, "libpipewire-module-loopback", config, NULL);
  if (!bridge->module) {
    fprintf(stderr, "Cannot create PipeWire capture source.\n");
    bridge->status = 1;
    pw_main_loop_quit(bridge->loop);
    return;
  }
  bridge->timer =
      pw_loop_add_timer(pw_main_loop_get_loop(bridge->loop), reconcile, bridge);
  struct timespec interval = {.tv_nsec = 100000000};
  pw_loop_update_timer(pw_main_loop_get_loop(bridge->loop), bridge->timer,
                       &interval, &interval, false);
}
static void core_error(void *data, uint32_t id, int seq, int res,
                       const char *message) {
  (void)seq;
  (void)res;
  struct bridge *bridge = data;
  if (id == PW_ID_CORE) {
    fprintf(stderr, "PipeWire: %s\n", message);
    bridge->status = 1;
    pw_main_loop_quit(bridge->loop);
  }
}
static const struct pw_core_events core_events = {
    PW_VERSION_CORE_EVENTS, .done = done, .error = core_error};
static void quit(void *data, int signal) {
  (void)signal;
  pw_main_loop_quit(((struct bridge *)data)->loop);
}
static void parent_input(void *data, int fd, uint32_t mask) {
  char bytes[32];
  if ((mask & SPA_IO_HUP) ||
      ((mask & SPA_IO_IN) && read(fd, bytes, sizeof(bytes)) <= 0))
    quit(data, 0);
}
int main(int argc, char **argv) {
  struct bridge bridge = {0};
  bridge.excluded_pid = getppid();
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--list"))
      bridge.listing = true;
    else if (i + 1 < argc && !strcmp(argv[i], "--exclude-pid"))
      bridge.excluded_pid = (pid_t)strtol(argv[++i], NULL, 10);
    else if (i + 1 < argc && !strcmp(argv[i], "--window"))
      bridge.window = strtoul(argv[++i], NULL, 10);
    else if (i + 1 < argc && !strcmp(argv[i], "--application"))
      bridge.application = argv[++i];
    else if (i + 1 < argc && !strcmp(argv[i], "--name"))
      bridge.name = argv[++i];
    else {
      fprintf(stderr, "Invalid capture option.\n");
      return 2;
    }
  }
  if (!bridge.listing &&
      (!bridge.application || !bridge.name || strlen(bridge.name) > 100 ||
       strspn(bridge.name, "abcdefghijklmnopqrstuvwxyz0123456789-") !=
           strlen(bridge.name)))
    return 2;
  if (prctl(PR_SET_PDEATHSIG, SIGTERM) != 0 || getppid() == 1)
    return 1;
  XSetErrorHandler(ignore_x_error);
  pw_init(NULL, NULL);
  bridge.loop = pw_main_loop_new(NULL);
  bridge.context = pw_context_new(pw_main_loop_get_loop(bridge.loop), NULL, 0);
  bridge.core = pw_context_connect(bridge.context, NULL, 0);
  if (!bridge.core) {
    fprintf(stderr, "PipeWire is unavailable.\n");
    pw_context_destroy(bridge.context);
    pw_main_loop_destroy(bridge.loop);
    return 1;
  }
  snprintf(bridge.capture_name, sizeof(bridge.capture_name), "%s-input",
           bridge.name ? bridge.name : "campfire-list");
  pw_core_add_listener(bridge.core, &bridge.core_listener, &core_events,
                       &bridge);
  bridge.registry = pw_core_get_registry(bridge.core, PW_VERSION_REGISTRY, 0);
  pw_registry_add_listener(bridge.registry, &bridge.registry_listener,
                           &registry_events, &bridge);
  pw_loop_add_signal(pw_main_loop_get_loop(bridge.loop), SIGINT, quit, &bridge);
  pw_loop_add_signal(pw_main_loop_get_loop(bridge.loop), SIGTERM, quit,
                     &bridge);
  if (!bridge.listing)
    pw_loop_add_io(pw_main_loop_get_loop(bridge.loop), STDIN_FILENO,
                   SPA_IO_IN | SPA_IO_HUP, false, parent_input, &bridge);
  bridge.seq = pw_core_sync(bridge.core, PW_ID_CORE, 0);
  pw_main_loop_run(bridge.loop);
  if (bridge.timer)
    pw_loop_destroy_source(pw_main_loop_get_loop(bridge.loop), bridge.timer);
  remove_links(&bridge, SPA_ID_INVALID);
  if (bridge.module)
    pw_impl_module_destroy(bridge.module);
  while (bridge.ports) {
    struct port *port = bridge.ports;
    bridge.ports = port->next;
    free(port);
  }
  while (bridge.nodes) {
    struct node *node = bridge.nodes;
    bridge.nodes = node->next;
    spa_hook_remove(&node->listener);
    pw_proxy_destroy((struct pw_proxy *)node->proxy);
    pw_properties_free(node->props);
    free(node);
  }
  spa_hook_remove(&bridge.registry_listener);
  pw_proxy_destroy((struct pw_proxy *)bridge.registry);
  spa_hook_remove(&bridge.core_listener);
  pw_core_disconnect(bridge.core);
  pw_context_destroy(bridge.context);
  pw_main_loop_destroy(bridge.loop);
  pw_deinit();
  return bridge.status;
}
