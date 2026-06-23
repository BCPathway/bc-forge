# @bc-forge/react UI components

Reusable, accessible, dependency-free React components. Each component ships
with inline styles (no CSS import or Tailwind setup required) and forwards
standard HTML attributes so it slots into any design system.

```tsx
import { Badge, Alert, Pagination, Modal } from '@bc-forge/react';
```

## Badge

Status pill for labels, counts, and states.

| Prop      | Type                                                                  | Default     | Description                          |
| --------- | --------------------------------------------------------------------- | ----------- | ------------------------------------ |
| `variant` | `'default' \| 'primary' \| 'success' \| 'warning' \| 'danger' \| 'info'` | `'default'` | Visual style.                        |
| `size`    | `'sm' \| 'md' \| 'lg'`                                                 | `'md'`      | Badge size.                          |
| `...rest` | `React.HTMLAttributes<HTMLSpanElement>`                               | —           | Any span prop (`className`, `aria-*`). |

Renders a `<span>` and forwards a `ref`. Provide `aria-label` when the visible
text isn't descriptive on its own (e.g. a bare count).

```tsx
<Badge variant="success">Verified</Badge>
<Badge variant="danger" size="lg" aria-label="3 failed checks">3</Badge>
```

## Alert

Inline notification banner. The ARIA role is derived from the variant —
`danger`/`warning` → `role="alert"` (assertive), `info`/`success` →
`role="status"` (polite). Pass `role` to override.

| Prop           | Type                                            | Default          | Description                                |
| -------------- | ----------------------------------------------- | ---------------- | ------------------------------------------ |
| `variant`      | `'info' \| 'success' \| 'warning' \| 'danger'`  | `'info'`         | Visual + semantic style.                   |
| `title`        | `React.ReactNode`                               | —                | Optional bold heading.                     |
| `onDismiss`    | `() => void`                                    | —                | When set, renders a keyboard-focusable dismiss button. |
| `dismissLabel` | `string`                                        | `'Dismiss alert'`| Accessible label for the dismiss button.   |
| `...rest`      | `React.HTMLAttributes<HTMLDivElement>`          | —                | Any div prop.                              |

```tsx
<Alert variant="success" title="Saved">Your changes were stored.</Alert>
<Alert variant="danger" onDismiss={() => setError(null)}>Mint failed.</Alert>
```

## Pagination

Page navigation rendered as a `<nav>` landmark with native `<button>`s
(keyboard-accessible out of the box). The active page carries
`aria-current="page"`; Previous/Next are `disabled` at the bounds. Returns
`null` when `totalPages <= 1`.

| Prop           | Type                       | Default        | Description                                   |
| -------------- | -------------------------- | -------------- | --------------------------------------------- |
| `currentPage`  | `number`                   | —              | 1-based current page.                         |
| `totalPages`   | `number`                   | —              | Total page count.                             |
| `onPageChange` | `(page: number) => void`   | —              | Called with the requested page (clamped).     |
| `siblingCount` | `number`                   | `1`            | Page buttons shown on each side of current.   |
| `ariaLabel`    | `string`                   | `'Pagination'` | Label for the `<nav>` landmark.               |
| `...rest`      | `React.HTMLAttributes<HTMLElement>` | —     | Any element prop (minus `onChange`).          |

The pure helper `getPaginationRange(currentPage, totalPages, siblingCount)` is
exported for testing/customisation; it returns page numbers with `'dots'`
sentinels where the range is collapsed.

```tsx
<Pagination currentPage={page} totalPages={20} onPageChange={setPage} />
```

## Modal

Accessible dialog with full focus management (WCAG 2.1 AA):

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → the title.
- Moves focus into the dialog on open and **restores** it to the trigger on close.
- **Traps** Tab / Shift+Tab inside the dialog.
- Closes on Escape and (optionally) on overlay click.

| Prop                  | Type              | Default          | Description                                  |
| --------------------- | ----------------- | ---------------- | -------------------------------------------- |
| `open`                | `boolean`         | —                | Whether the dialog is mounted and visible.   |
| `onClose`             | `() => void`      | —                | Called on Escape, close button, overlay click.|
| `title`               | `React.ReactNode` | —                | Dialog heading; also the accessible name.    |
| `children`            | `React.ReactNode` | —                | Dialog body.                                 |
| `closeOnOverlayClick` | `boolean`         | `true`           | Close when the backdrop is clicked.          |
| `closeLabel`          | `string`          | `'Close dialog'` | Accessible label for the header close button.|

```tsx
<Modal open={isOpen} onClose={() => setIsOpen(false)} title="Confirm mint">
  <p>Mint 1,000 tokens to G…ABC?</p>
  <button onClick={confirm}>Confirm</button>
</Modal>
```
