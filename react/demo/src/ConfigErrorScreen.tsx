// SPDX-License-Identifier: MIT
import React from 'react';
import { Alert } from '@bc-forge/react';

import { ENV_TEMPLATE, type ConfigIssue } from './config';

export interface ConfigErrorScreenProps {
  /** Every problem found while validating the environment (#1146). */
  issues: readonly ConfigIssue[];
}

const PAGE_STYLE: React.CSSProperties = {
  fontFamily: 'sans-serif',
  maxWidth: 860,
  margin: '0 auto',
  padding: 24,
  color: '#111827',
};

const LIST_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 0,
  margin: 0,
  listStyle: 'none',
};

const ITEM_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 12,
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  backgroundColor: '#ffffff',
};

const TEMPLATE_STYLE: React.CSSProperties = {
  padding: 12,
  border: '1px solid #d1d5db',
  borderRadius: 8,
  backgroundColor: '#f9fafb',
  overflowX: 'auto',
  fontSize: 13,
};

/** `VITE_RPC_URL` becomes `vite-rpc-url`, for stable `data-testid` values. */
function toSlug(field: string): string {
  return field
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when `value` holds anything worth showing. */
function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Configuration error screen rendered instead of the demo (#1146).
 *
 * Lists every problem at once — field, what was received, what is expected and
 * how to fix it — followed by a copy-pasteable `.env` template. It is a plain,
 * accessible document: no provider, no SDK calls, and nothing that can throw.
 */
export const ConfigErrorScreen: React.FC<ConfigErrorScreenProps> = ({ issues }) => (
  <section data-testid="config-error-screen" style={PAGE_STYLE}>
    <h1 style={{ margin: '0 0 12px', fontSize: 24 }}>bc-forge React Demo — configuration error</h1>

    <Alert variant="danger" title="The demo cannot start with the current environment">
      Fix the {issues.length} problem{issues.length === 1 ? '' : 's'} below and restart the dev
      server. Nothing on this page talks to the network.
    </Alert>

    <ol data-testid="config-error-list" style={LIST_STYLE}>
      {issues.map((issue, index) => (
        <li
          key={`${issue.field}-${index}`}
          data-testid={`config-error-${toSlug(issue.field)}`}
          style={ITEM_STYLE}
        >
          <code data-testid={`config-error-field-${toSlug(issue.field)}`}>
            {issue.field}
          </code>
          <div data-testid={`config-error-message-${toSlug(issue.field)}`}>
            {issue.message}
          </div>
          {hasValue(issue.received) ? (
            <div style={{ fontSize: 13, color: '#4b5563' }}>
              Received:{' '}
              <code data-testid={`config-error-received-${toSlug(issue.field)}`}>
                {issue.received === '' ? '(empty string)' : issue.received}
              </code>
            </div>
          ) : null}
          {hasValue(issue.expected) ? (
            <div style={{ fontSize: 13, color: '#4b5563' }}>
              Expected:{' '}
              <code data-testid={`config-error-expected-${toSlug(issue.field)}`}>
                {issue.expected}
              </code>
            </div>
          ) : null}
          {hasValue(issue.hint) ? (
            <div style={{ fontSize: 13, color: '#4b5563' }}>{issue.hint}</div>
          ) : null}
        </li>
      ))}
    </ol>

    <h2 style={{ fontSize: 18 }}>Fix</h2>
    <p style={{ fontSize: 14, color: '#4b5563' }}>
      Create a <code>.env</code> file in <code>react/demo/</code> with the following contents, then
      restart <code>npm run dev</code>. See <code>react/demo/README.md</code> for the full list of
      variables.
    </p>
    <pre data-testid="config-error-template" style={TEMPLATE_STYLE}>
      <code>{ENV_TEMPLATE}</code>
    </pre>
  </section>
);