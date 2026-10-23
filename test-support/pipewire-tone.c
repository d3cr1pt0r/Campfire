// Silent-to-speakers fixture: an application output linked only by the capture
// test.
#include <math.h>
#include <pipewire/pipewire.h>
#include <signal.h>
#include <spa/param/audio/format-utils.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct tone {
  struct pw_main_loop *loop;
  struct pw_stream *stream;
  double phase, frequency;
};
static void process(void *data) {
  struct tone *tone = data;
  struct pw_buffer *buffer = pw_stream_dequeue_buffer(tone->stream);
  if (!buffer)
    return;
  struct spa_data *output = &buffer->buffer->datas[0];
  if (output->data) {
    unsigned frames = output->maxsize / (2 * sizeof(float));
    if (buffer->requested && buffer->requested < frames)
      frames = buffer->requested;
    float *samples = output->data;
    for (unsigned i = 0; i < frames; i++) {
      float value = (float)(0.15 * sin(tone->phase));
      samples[i * 2] = samples[i * 2 + 1] = value;
      tone->phase += 2 * M_PI * tone->frequency / 48000;
      if (tone->phase >= 2 * M_PI)
        tone->phase -= 2 * M_PI;
    }
    output->chunk->offset = 0;
    output->chunk->stride = 2 * sizeof(float);
    output->chunk->size = frames * 2 * sizeof(float);
  }
  pw_stream_queue_buffer(tone->stream, buffer);
}
static const struct pw_stream_events events = {PW_VERSION_STREAM_EVENTS,
                                               .process = process};
static void quit(void *data, int signal) {
  (void)signal;
  pw_main_loop_quit(((struct tone *)data)->loop);
}
int main(int argc, char **argv) {
  struct tone tone = {.frequency = argc > 1 ? atof(argv[1]) : 440};
  const char *name = argc > 2 ? argv[2] : "Campfire capture fixture";
  pw_init(NULL, NULL);
  tone.loop = pw_main_loop_new(NULL);
  tone.stream = pw_stream_new_simple(
      pw_main_loop_get_loop(tone.loop), name,
      pw_properties_new(PW_KEY_MEDIA_TYPE, "Audio", PW_KEY_MEDIA_CATEGORY,
                        "Playback", PW_KEY_MEDIA_ROLE, "Music", PW_KEY_APP_NAME,
                        name, PW_KEY_NODE_NAME, name, PW_KEY_NODE_AUTOCONNECT,
                        "false", NULL),
      &events, &tone);
  uint8_t storage[1024];
  struct spa_pod_builder builder =
      SPA_POD_BUILDER_INIT(storage, sizeof(storage));
  const struct spa_pod *params[] = {spa_format_audio_raw_build(
      &builder, SPA_PARAM_EnumFormat,
      &SPA_AUDIO_INFO_RAW_INIT(.format = SPA_AUDIO_FORMAT_F32, .rate = 48000,
                               .channels = 2,
                               .position = {SPA_AUDIO_CHANNEL_FL,
                                            SPA_AUDIO_CHANNEL_FR}))};
  if (pw_stream_connect(tone.stream, PW_DIRECTION_OUTPUT, PW_ID_ANY,
                        PW_STREAM_FLAG_MAP_BUFFERS | PW_STREAM_FLAG_RT_PROCESS,
                        params, 1) < 0)
    return 1;
  pw_loop_add_signal(pw_main_loop_get_loop(tone.loop), SIGTERM, quit, &tone);
  pw_loop_add_signal(pw_main_loop_get_loop(tone.loop), SIGINT, quit, &tone);
  pw_main_loop_run(tone.loop);
  pw_stream_destroy(tone.stream);
  pw_main_loop_destroy(tone.loop);
  pw_deinit();
  return 0;
}
