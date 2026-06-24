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

## Dropdown

Reusable menu button. Implements the
[WAI-ARIA Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)
pattern with full keyboard navigation (ArrowDown, ArrowUp, Home, End, Enter,
Space, Escape). Supports controlled and uncontrolled modes.

```tsx
import { Dropdown } from '@bc-forge/react';
```

### DropdownItem

| Field      | Type      | Default | Description              |
| ---------- | --------- | ------- | ------------------------ |
| `label`    | `string`  | —       | Display text.            |
| `value`    | `string`  | —       | Unique identifier.       |
| `disabled` | `boolean` | —       | Prevents selection.      |

### Dropdown Props

| Prop          | Type                                                        | Default       | Description                                              |
| ------------- | ----------------------------------------------------------- | ------------- | -------------------------------------------------------- |
| `items`       | `DropdownItem[]`                                            | —             | Array of menu items.                                     |
| `value`       | `string`                                                    | —             | Controlled selected value.                               |
| `defaultValue`| `string`                                                    | —             | Initial selected value (uncontrolled).                   |
| `onChange`    | `(item: DropdownItem) => void`                              | —             | Called when an item is selected.                         |
| `variant`     | `'default' \| 'primary' \| 'danger'`                       | `'default'`   | Visual style.                                            |
| `size`        | `'sm' \| 'md' \| 'lg'`                                     | `'md'`        | Size.                                                    |
| `placeholder` | `string`                                                    | `'Select...'` | Placeholder when nothing is selected.                    |
| `disabled`    | `boolean`                                                   | —             | Disables the entire dropdown.                            |
| `...rest`     | `React.HTMLAttributes<HTMLDivElement>`                      | —             | Any div prop; also forwards a `ref`.                     |

```tsx
<Dropdown
  items={[
    { label: 'Manager', value: 'manager' },
    { label: 'Contributor', value: 'contributor' },
  ]}
  placeholder="Select a role"
  onChange={(item) => console.log(item.value)}
/>
<Dropdown
  variant="primary"
  size="lg"
  items={[{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }]}
/>
```
