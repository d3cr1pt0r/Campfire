# Client UI/UX review — 17 October 2026

This pass applies Apple’s guidance on hierarchy, alignment, control spacing, adaptable layouts, clear actions, and focus to Driskord’s existing React/Electron interface. The application keeps its dark appearance and purple accent. This is a cross-platform interface improvement, not a claim of native Apple HIG or accessibility compliance.

References: [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Modality](https://developer.apple.com/design/human-interface-guidelines/modality), and [Split views](https://developer.apple.com/design/human-interface-guidelines/split-views).

## Findings and changes

| Feature | Finding | Result |
| --- | --- | --- |
| Shared typography and spacing | Many labels used 7–10px text; unavailable font names produced inconsistent fallback rendering. | System font stack, minimum 11px ancillary text, 14px chat text, clearer secondary text, and consistent spacing. |
| Buttons and switches | Toolbar, channel management, user, and dialog controls had very small targets. | Common 36px icon targets for pointer use; key controls grow to 44px on devices without hover. Switches have larger tracks. Custom buttons show pressed feedback. |
| Sign up and sign in | Username placeholder suggested an editable display name. | Permanent username explanation during registration, appropriate sign-in placeholder, and disabled capitalization/spellchecking. |
| Connection and retry | Disconnection was mostly represented by a colored dot; the user footer always said Online. | Visible reconnecting banner, accurate footer status, and an accessible connection label. Existing retry/server-switch paths remain available. |
| Server rail and channel navigation | Fixed three-column layouts squeezed chat at narrow widths. Rail content could be clipped vertically. | Scrollable rail; below 800px, channels, friends, account, and server actions move into a dismissible drawer with keyboard focus containment. |
| Text channels, voice channels, and DMs | Category controls were cramped; selected navigation was largely visual. | Spaced controls, nonwrapping category labels, and current-page semantics for text channels and Friends. Selecting a destination closes the narrow drawer. |
| Community members | The list disappeared below 950px even though its toggle remained available. | Optional side inspector below 1100px, with a visible close button. Narrow launches start with the inspector closed. |
| Friends | Accepted, incoming, and outgoing relationships shared a list headed only by the accepted count. | All friends, Online, and Requests filters; incoming count; contextual empty states; named row actions; reasons for unavailable calls. |
| Accept, decline, cancel, and remove friend | A generic confirmation did not distinguish removing a friend from cancelling or declining a request. | Contextual confirmation titles and action labels, with a separate Cancel button. |
| Chat history and pagination | Loading and request errors lacked consistent placement. | Inline feedback and a centered older-history control. Existing pagination and conversation filtering remain intact. |
| Search and pins | Combined filters were unclear and lacked a direct way to clear them. | Explicit combined-filter headings, clear-filter actions, named search field, search input semantics, pin pressed state, and no premature empty-result state while loading. |
| Message actions | Hover-only actions could not reliably be reached by keyboard. | Actions stay in the tab order and reveal on focus; devices without hover show the actions below the message. |
| Editing and deleting messages | Editing used a single-line input; deletion ended in a generic Confirm button. | Multiline editing and explicit Delete message / Cancel actions. Message timestamps expose their full date and time. |
| Reactions and emoji picker | Selected reactions lacked accessible toggle state; narrow layouts removed the composer emoji button. | Reaction counts and pressed state are announced; emoji entry remains reachable at narrow widths. Existing standard/custom picker remains available. |
| Composer and typing | Small controls, weak focus feedback, and one-row text entry hindered composition. Enter could submit during IME composition. | Larger attachment/emoji/send controls, focus border, growing textarea, and IME-safe Enter handling. Typing, character limits, Shift+Enter, and read-only behavior are retained. |
| File picker, drag/drop, and downloads | Long attachment names and constrained widths risked overflow. | Wrapping upload previews and bounded attachment cards. Existing validation, review-before-send, drag/drop overlay, authenticated preview, and download flows are retained. |
| Image viewer | Shared viewer header/footer controls needed better spacing and wrapping. | Larger close/full-screen controls, wrapping long names and footer controls, and bounded image presentation. Existing retry/error and return paths are retained. |
| Voice and private calls | Toggle labels did not explain the current action; video, names, and playback controls competed for the same space. | State-specific microphone/camera/share labels and pressed state; remote video occupies a stage above the participant name and volume controls. Call buttons and details wrap. |
| Stream watching and independent volumes | Watch, voice volume, and stream volume were overlaid on the video. | These controls use a separate wrapping footer beneath remote video. Sender-side subscription behavior and independent voice/stream volumes are preserved. |
| Call invitations | Already-invited participants could still be described as Invite. | Invite rows distinguish In this call, Invited, Offline, and available Invite states. Existing invitation accept/decline flows remain intact. |
| Expanded video | Long titles and independent volume/stop-watching controls could crowd the footer. | Wrapping header/footer layout and larger close/full-screen actions. Existing muted preview, playback recovery, and stop-watching behavior are retained. |
| Account, nickname, and profile picture | Bare avatar actions were hard to identify; lengthy content needed reliable scrolling. | Secondary action styling, clear destructive picture-removal styling, readable labels, and independently scrolling settings content. Username/nickname behavior is preserved. |
| Avatar crop | Crop actions could exceed a narrow row. | Wrapping action groups and bounded preview width. Dragging and the equivalent zoom/position sliders remain available. |
| Voice/video settings and microphone test | Dense labels and unclear persistence made the controls harder to scan. | Readable labels, larger switches, consistent microphone-test typography, and explicit automatic-save guidance. Device fallback and microphone analysis behavior are unchanged. |
| Notification settings | Persistence was unclear. | Explicit automatic-save guidance and a larger switch; existing OS permission handling is retained. |
| Server settings and switching | Dense fields and technical help reduced clarity. | Readable fields and plain-language relay guidance. Existing role checks and the sign-out/server-switch explanation are retained. |
| Roles and member assignments | Tiny edit controls, raw permission names, and narrow selects hindered scanning. | Larger edit controls, readable permission names, wrapping role summaries, and accessible per-member role labels. Assignment is disabled while an operation is pending. |
| Channel rename, access, and deletion | Save/rename actions looked like bare text; role controls needed narrow layouts. | Secondary action buttons, readable cards/fields, and wrapping labels. Existing protected-channel rules and inline deletion confirmation remain intact. |
| Custom emoji management | Deletion immediately removed a shared asset. | Inline Delete emoji / Cancel confirmation, named delete control, wrapping rows, and consistent file-picker styling. |
| Settings navigation | Desktop-style navigation compressed the content; horizontal narrow tabs overlapped the close control during initial rendering review. | Desktop sidebar plus an explicitly labeled section selector at narrow widths. Close occupies its own space, and Sign out remains available on narrow screens. |
| Dialogs and focus | Generic dialog names and focus restoration could lose the active context when switching tasks or closing nested views. | Task-derived dialog names, refreshed focus when modal tasks change, preservation of form autofocus, and restoration limited to the active dialog context. Pending operations prevent accidental dismissal. |
| Notifications and motion | Bottom toasts obscured the composer; animations ignored reduced-motion preferences. | Notifications appear at the upper right, are width/height bounded, and remain dismissible. Reduced-motion preferences disable transitions and animation. |

## Implementation files

- `src/style.css`: shared typography, control sizing, responsive navigation/inspectors, chat, media, forms, settings, and motion.
- `src/main.tsx`: navigation drawer, connection feedback, search/member controls, composer, and dialog behavior.
- `src/FriendsPanel.tsx`: friend/request filtering, empty states, and action labels.
- `src/ChatMessages.tsx`: filter feedback, history feedback, keyboard-accessible actions, reaction semantics, and timestamps.
- `src/CallPanel.tsx`: state-specific call control labels and semantics.
- `src/SettingsPanel.tsx`: adaptive section selection, account actions, settings guidance, role labels, and emoji deletion confirmation.
- `src/ChannelSettings.tsx`: channel action styling.
- `src/forms.tsx`: multiline message editing, busy feedback, and role dialog heading.
- `src/useDialog.ts`: modal-context focus refresh and safe focus restoration.

## Validation

- TypeScript check, production build, existing unit suite, formatting, and whitespace checks.
- Rendered the production build in hidden Electron windows against a separate localhost server with disposable accounts/data. Existing server data was not used.
- Checked 1440×940, 960×640, 390×844, and 320×568 layouts for document overflow and clipped toolbar/composer/settings/friend/action containers.
- Inspected screenshots of authentication, chat, pins, every settings section, friends/requests, narrow navigation/member inspector, and dialogs.
- Exercised keyboard access to message actions and focus containment in the narrow navigation drawer.
- Exercised emoji insertion, image attachment/send/expansion, avatar crop cancellation, and custom emoji upload/deletion confirmation.
- Joined a voice call with two isolated clients using synthetic microphone/camera devices; inspected participant tiles, camera expansion, call details, and narrow call layouts.

## Limits and remaining considerations

- Synthetic media checks establish UI behavior, not real microphone/speaker quality, device switching, desktop capture permissions, system audio, or sender-side bandwidth isolation. The isolated synthetic call displayed an output-device AbortError; physical output was not validated.
- Native screen/window picker behavior, OS notifications, actual full-screen transitions, drag/drop from the desktop, and attachment saving were reviewed in source but were not exercised end to end on each operating system.
- Touch rules were reviewed in CSS; physical touch, screen-reader use, every long/localized string, and formal contrast/target-size compliance still need dedicated testing. This pass retains the dark appearance.
- Existing unsaved-form dismissal and draft reset behavior remains; a separate draft-preservation/unsaved-changes design would be needed to change those workflows consistently.
