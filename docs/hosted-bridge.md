# Hosted bridge boundary

A paid hosted bridge sells custody and operations, not exclusive dashboard features. Self-hosters using their own provider credentials must be able to use the same providers and extension behavior.

## Kept open in this repository

- the complete reference bridge in `apps/bridge`;
- the versioned bridge protocol and conformance tests;
- the extension-side bridge client with no preferred host or hidden service URL;
- built-in and future provider OAuth adapters;
- the store interface and optional `authorizeSession` policy seam;
- the provider-neutral `activation_required` response and UI;
- security fixes that affect the shared OAuth or session implementation.

## Kept in private service repositories

- billing, plans, quotas, invoices, and entitlement decisions;
- account linkage, email, and activation web pages;
- production database adapters, envelope encryption, key rotation, and backup implementation;
- infrastructure, secrets management, monitoring, incident runbooks, and abuse controls;
- registered provider applications, credentials, quota agreements, and approval material;
- administrative and support tools;
- aggregate operational analytics limited to service and connection activity.

The hosted service should import or build on the open bridge core and inject private storage and authorization implementations. It should not maintain a fork of the OAuth protocol logic, and the extension must treat it as an ordinary user-selected bridge URL.

Panodash remains MIT-licensed. Competing operators may host the code, but the trademark policy governs use of the Panodash name and visual identity.
