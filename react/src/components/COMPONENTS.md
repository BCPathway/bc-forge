# @bc-forge/react components

Reusable, accessible, dependency-free React components (inline styles, no CSS
import or Tailwind setup required).

```tsx
import { Alert } from '@bc-forge/react';
```

## Alert

Inline notification banner. The ARIA role is derived from the variant:
`danger`/`warning` render as `role="alert"` (assertive), `info`/`success` as
`role="status"` (polite). Pass `role` to override.

| Prop           | Type                                            | Default           | Description                                            |
| -------------- | ----------------------------------------------- | ----------------- | ------------------------------------------------------ |
| `variant`      | `'info' \| 'success' \| 'warning' \| 'danger'`  | `'info'`          | Visual + semantic style.                               |
| `title`        | `React.ReactNode`                               | —                 | Optional bold heading.                                 |
| `onDismiss`    | `() => void`                                    | —                 | When set, renders a keyboard-focusable dismiss button. |
| `dismissLabel` | `string`                                        | `'Dismiss alert'` | Accessible label for the dismiss button.               |
| `...rest`      | `React.HTMLAttributes<HTMLDivElement>`          | —                 | Any div prop; also forwards a `ref`.                   |

```tsx
<Alert variant="success" title="Saved">Your changes were stored.</Alert>
<Alert variant="danger" onDismiss={() => setError(null)}>Mint failed.</Alert>
```

## Badge

Small label used for statuses, counts, or categories. When `onClick` is
provided the badge becomes a keyboard-focusable interactive control
(`role="button"`, `tabIndex={0}`, Enter/Space activation). Pass explicit
`role` or `tabIndex` to override.

| Prop      | Type                                                           | Default     | Description                                                      |
| --------- | -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `variant` | `'default' \| 'primary' \| 'success' \| 'warning' \| 'danger' \| 'info'` | `'default'` | Visual style.                                                    |
| `size`    | `'sm' \| 'md' \| 'lg'`                                        | `'md'`      | Sizing preset.                                                   |
| `...rest` | `React.HTMLAttributes<HTMLSpanElement>`                        | —           | Any span prop; also forwards a `ref`.                            |

```tsx
<Badge variant="primary">Live</Badge>
<Badge variant="success" size="sm">Verified</Badge>
<Badge variant="warning" onClick={() => alert('clicked')}>Dismiss</Badge>
```
