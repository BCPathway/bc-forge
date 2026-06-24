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
