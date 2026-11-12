# Security

Skywake stores other people's files, so we take reports seriously.

## Reporting a problem

Please don't open a public issue for a security problem. Report it
privately through GitHub instead: on this repository, open **Security →
Report a vulnerability**. Include what you found, how to reproduce it, and
what an attacker could do with it.

We will acknowledge the report within three working days, keep you updated
while we fix it, and credit you in the release notes unless you would rather
we didn't.

## What counts

Anything that lets someone read, change or delete data they shouldn't, or
break the guarantees the README makes, for example:

- reading another branch's or tenant's content without access to it
- a save, takeover or crash that silently loses or corrupts data
- an old owner of a branch overwriting the new one after a move
- content that passes the BLAKE3 check but isn't what was written

## Supported versions

Skywake is pre-1.0. Fixes go into `main` and the latest release only.
