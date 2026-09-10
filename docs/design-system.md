# EchoWave Design System

**English** | [简体中文](./design-system.zh-CN.md)

## 1. Scope

This is the authoritative frontend design specification for iOS, Android, and Web. It defines text colors, the listed bold weights, typography, spacing, radii, surfaces, shared tabs, and named card layouts. Do not infer unspecified visual rules from examples. Where code conflicts with this document, align code through an explicitly scoped change.

## 2. Text colors

Text may use only these exact values:

| Semantic level | Value     | Use                                                          |
| -------------- | --------- | ------------------------------------------------------------ |
| Primary        | `#000000` | Body, titles, critical information, active/selected text     |
| Secondary      | `#5A6472` | Descriptions, supporting information, inactive items/actions |
| Tertiary       | `#A3A3A3` | Labels, timestamps, and non-critical metadata                |

Success, warning, error, and processing text still use these colors. Express status through icons, backgrounds, borders, and understandable wording, never color alone. Do not derive text colors through opacity, hard-code local substitutes, or use tertiary text for required actions or error reasons.

## 3. Fonts

EchoWave uses Source Han Sans CN for ordinary interface text and LXGW WenKai Lite for the KaiTi semantic range used by transcript and emotion content. Emotion page titles, navigation, and controls remain Source Han Sans CN.

- Bundle `SourceHanSansCN-Regular.otf`, `SourceHanSansCN-Bold.otf`, and `LXGWWenKaiLite-Regular.ttf` for iOS, Android, and Web under `apps/mobile/assets/fonts/` with their SIL Open Font License 1.1 notices.
- Never replace bundled assets with same-named system fonts or depend on device-installed fonts.
- Show explicit loading/error states and mount the primary UI only after fonts load; never silently fall back.
- Do not add a weight or font use without an available licensed asset and a corresponding design requirement.

## 4. Typography

| Level         | Size   | Line height | Use                                                              |
| ------------- | ------ | ----------- | ---------------------------------------------------------------- |
| Group name    | `40px` | `60px`      | Group-page name only                                             |
| Display title | `32px` | `48px`      | Analysis results, AI labels, knowledge details, document preview |
| Heading 1     | `18px` | `26px`      | Top navigation of standalone pages                               |
| Heading 2     | `16px` | `24px`      | Large card title                                                 |
| Heading 3     | `14px` | `20px`      | File or small-card title                                         |
| Heading 4     | `12px` | `18px`      | Selected tab                                                     |
| Heading 5     | `10px` | `14px`      | Unselected tab or option-menu title                              |
| Body          | `14px` | `20px`      | Primary prose                                                    |
| Supporting    | `12px` | `18px`      | Description and secondary explanation                            |
| Label         | `10px` | `14px`      | Tags and compact metadata                                        |

Group names, display titles, tab titles, analysis titles, card titles, and count headings such as “X audio files” are bold. Use `fontWeight: 'bold'`, not numeric weights. An icon or spinner sharing one semantic line with text uses the adjacent token's `lineHeight` as a square size and aligns centrally. `px` means React Native logical pixels on native and CSS pixels on Web.

## 5. Spacing

All layout spacing—`margin`, `padding`, `gap`, and screen-edge inset—is a multiple of `4px`. Typical values are `8px` between analysis cards and `16px` at screen edges and inside the Audio Analysis, Linked Knowledge, and Connected Data Sources pages. This rule does not constrain type, line height, component dimensions, or icon dimensions.

## 6. Radii

Ordinary components use `4px`. Explicit designs override it. Circles, avatars, badges, and pills may use full rounding. Do not invent `8px`, `12px`, or other radii for ordinary components.

## 7. Peer-page gestures

Ordered analysis peer tabs support both tab presses and horizontal swipes. Swiping left advances and swiping right returns without wrapping at the ends. Horizontal recognition must not steal vertical scroll or gestures owned by players/timelines. Bottom-level navigation is not peer content and does not gain swipe navigation from this rule.

## 8. Side-panel animation

A side panel slides in from its edge and exits along the same path; it stays mounted until the exit animation completes. Close button, backdrop, system back, item switch, and successful action all share that exit path. Group panels use 220 ms enter and 200 ms exit translation, no modal fade. Ignore repeated close actions during exit.

## 9. Single-line input alignment

Fixed-height inputs use explicit `height`, `paddingVertical: 0`, and `textAlignVertical: 'center'`; Android also uses `includeFontPadding: false`. Do not substitute `minHeight`. Placeholder and value share font, size, line height, and alignment. The group-name field is `44px`; the current-group search wrapper is `48px` and its input is `46px`.

## 10. Surfaces

- `colors.background` and `colors.canvas` are `#F9F9F9`.
- `colors.card` and `colors.white` are `#FFFFFF`.
- `colors.black` is `#171717` for dark controls/surfaces, never primary text.
- `PageHeader` matches the base background.
- Knowledge detail uses base background for its header and white for tabs/linked groups, with `16px` before overview content.
- Document detail safe areas are white; generic placeholder safe areas use base background with white content cards.

Use semantic tokens rather than repeated local hex values.

## 11. Shared tabs

Peer content uses compact `PageTabs`, left-aligned at content width instead of equally stretched. Minimum height is `34px`, horizontal inset `16px`, and label gap `24px`. Labels and active underline align to the bottom. Presses and swipes update one active state.

## 12. Empty descriptions and linked-group cards

Empty knowledge descriptions show “No description”. List cards and the detail header reserve at least two body lines (`40px`) to prevent vertical jumps. Linked-group cards use `#F9F9F9`, `4px` radius, `16px` horizontal padding, `12px` vertical padding, and `24px` between main content. Height remains content-driven.

## 13. Top-level headers and shared cards

Bottom-navigation pages use a fixed header after the top safe area. Standard insets are `16px` horizontal and `24px` top/bottom; title/action rows are at least `44px`. Actions have `8px` gaps and `44×44px` touch targets. The text New action uses a white surface, divider border, `4px` radius, and plus icon with one consistent label.

Shared content cards use white, a thin divider border, `4px` radius, `16px` padding, and `8px` gaps, without platform shadows or filler minimum heights. Body areas use `16px` horizontal padding and at least `40px` bottom space.

## 14. Current implementation

Theme `textColors`, `colors.ink`, `colors.secondary`, and `colors.muted` match the required text values. Spacing, radius, and typography tokens are aligned. Bundled fonts and licenses exist and root layout gates the UI on successful loading. Transcript and emotion content use the KaiTi token. Group and analysis-detail tabs support press and swipe. Side panels, fixed-height inputs, surfaces, shared headers/tabs/cards, empty descriptions, and linked-group cards are implemented through the shared tokens and components.

## 15. Change boundary

This document does not authorize additional fonts, text colors, typography levels, weights, icon sizes, spacing, radii, or visual exceptions. Update this specification and complete design review before introducing a new semantic rule.
