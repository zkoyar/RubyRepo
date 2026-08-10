# Security policy

RubyRepo brokers a GitHub token and launches the system `git` client
over folders the user chooses. Security reports are therefore welcome and
treated as a priority.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](../../security/advisories/new) to
open a confidential report. This creates a private security advisory shared
only with the reporter and the repository maintainers.

Repository administrators must enable this channel under **Settings > Security
> Code security and analysis > Private vulnerability reporting**. If GitHub
reports that the channel is unavailable, do **not** disclose the vulnerability
in a public issue; private reporting must be enabled first.

Include, where possible: the app version, the operating system, the Git version,
and the smallest steps that reproduce the problem.

## Supported versions

Only the latest released version receives fixes.

## Threat model

What the project **undertakes** to guarantee:

- the GitHub App token never ends up in process arguments, environment
  variables, repository configuration, logs or error messages. It is handed to
  the individual Git process through a local askpass broker on `127.0.0.1`,
  protected by a random nonce and valid for a single delivery;
- the token is used only towards HTTPS remotes whose host is exactly
  `github.com`, on the standard port and with no credentials embedded in the
  URL;
- commands operate only on repositories returned by the latest scan or
  explicitly linked, and always in their canonical form. The folder to scan and
  the folder to link are chosen in a dialog opened **by the backend**, which
  records the path: the interface cannot present as "chosen by the user" a
  folder the user has never seen;
- fetch and push disable the `ext` protocol, Git hooks and Git traces;
- the logs on disk contain no token, no API response body and no Git output.

What the project does **not** guarantee, and should be kept in mind:

- **it is not a sandbox for hostile repositories.** Git configuration, hooks,
  filters, credential helpers and signing programs present in a repository can
  run local code during the operations that do not explicitly exclude them.
  Select only folders whose origin you know;
- the `Administration` permission of the GitHub App allows creating and deleting
  repositories. The app uses it only on an explicit command and with a typed
  confirmation, but the permission granted stays broad;
- the installers are not signed: their authenticity has to be verified
  separately.

## A note on translated messages

Since version 0.8 the app speaks five languages, and error messages travel from
the backend as an identifier plus separate parameters rather than as a finished
sentence. This changes nothing about what is exposed: the parameters carry the
same values the sentence used to contain — a path, a reason, a count — and the
redaction of credentials from remote URLs happens before they are filled in.

Two kinds of text are deliberately **not** translated, and both are safe to show
as they are: Git's own output, which is Git speaking rather than the
application, and messages from the operating system, which arrive in the
language of the system.
