<p align="center">
  <img src="https://vera.mediafranca.net/assets/vera_vera-logo.svg" width="112" alt="Vera logo">
</p>

# Vera

*English · [Español](README.es.md)*

> An infrastructure for keeping and traversing one's own intellectual memory,
> and for working with artificial intelligences without handing them its governance.

![Vera showing a page and its relationship graph](https://vera.mediafranca.net/assets/vera-interface.png)

VERA does not set out to build another artificial intelligence or to replace
existing platforms. It researches and builds a layer that is missing today
between a person and those platforms: a longitudinal, sovereign and traceable
intellectual memory, governed by its author, on which different intelligences
can work without taking ownership of it.

The academic question that organizes the project is this: **how can a person
preserve their agency, memory, authorship and critical capacity when multiple
artificial intelligences take part, over years, in their education and
research?** VERA is at once the experimental instrument for investigating that
question and the technological artifact being tested. It does not assume the
answer is already settled, nor that software alone produces better learning.

## A chain of sovereignty

VERA is more than a standalone application. It is a chain of decisions and
guarantees:

1. the person keeps their corpus in readable, portable formats;
2. every intervention retains identity, provenance, authorship and history;
3. the person decides what each agent may read, write or publish;
4. changing device, institution, interface or AI provider does not require
   abandoning the accumulated memory;
5. sovereign graphs can collaborate through shared standards without merging
   into a central database.

What matters is not only the final text. It is also the **intellectual path**:
the sources, questions, relationships, revisions, disagreements and human or
machine contributions that made an idea possible. In a university setting,
that path can be studied, reflected on and assessed without reducing
authorship to the false question of whether a sentence was written entirely by
a person or by a machine.

Technically, VERA is a *local-first* personal wiki, maintainable by people and
agents. The project is documented from its own corpus so as not to maintain
parallel versions of the same explanation.

## Born from within

VERA began in an individual situation: its own corpus was used to think about,
discuss and document the system while it was being built. In that first stage,
a separately installed **Librarian** —an OpenClaw instance— worked as an agent
on the memory through the same doors VERA offers to other agents. Later
development has also used other tools, including Codex, directly on the
repository.

The Librarian is not built into VERA and is not a privileged authority. It is
one possible configuration: an agent with explicit identity, permissions and
provenance. Anyone replicating the system can connect a different agent, give
it another name, or install none at all. What transfers is not that character,
but the separation between the sovereign corpus, the application that governs
it, and the replaceable agents authorized to collaborate with it.

The project now seeks to take that situated experience into a collective,
testable conversation. That the system has served to examine its own
construction is a valuable precedent; it does not by itself show that the
configuration generalizes without friction. That has to be tested with other
people, corpora and university contexts.

## Learn about Vera

The project's public documentation is currently written in Spanish:

- [Overview](https://vera.mediafranca.net/vera/)
- [Manual](https://vera.mediafranca.net/vera-manual/)
- [Principles](https://vera.mediafranca.net/vera-principios/) and [ethical stance](https://vera.mediafranca.net/vera-postura-etica/)
- [Roadmap](https://vera.mediafranca.net/vera-roadmap-de-producto-y-desarrollo/)
- [Architecture](https://vera.mediafranca.net/vera-arquitectura/)
- [Security](https://vera.mediafranca.net/vera-seguridad/)
- [Try and install](https://vera.mediafranca.net/vera-probar-e-instalar/)

Vera is currently a **research alpha**: it runs on a real corpus, but for now
it is meant for one person and one graph. It is not yet a production-ready
multi-user service.

> [!WARNING]
> The private application listens on loopback by default. Do not expose that
> port directly to the Internet: people do not yet authenticate to Vera. Read
> [Security](SECURITY.md) and [Exposing Vera](docs/exponer-vera.md) before
> changing the network boundary.

## Install Vera

### In three steps

1. **Download Vera Desktop** for Windows, macOS or Linux from the
   [latest release](https://github.com/mediafranca/vera/releases/latest).
2. **Open the application.** Vera creates an initial memory on your computer;
   the corpus is not uploaded to MediaFranca or to any AI provider.
3. **Connect the AI of your choice** from Vera's **MCP** page. If the client
   runs on the same computer, use the local connection. If it lives on the
   Internet, enable **Vera Conecta**, create an access for that client and copy
   the URL and credential Vera shows only once.

The AI should first run `vera_quien_soy`: this lets you check the identity and
scopes it connected with before letting it read or write. A Conecta URL does
not open the library on its own; each client needs its own revocable
credential.

There are two ways to install, depending on what you need.

### Desktop application (recommended)

The simplest way to try Vera without touching code: an initial memory already
loaded and, where commercial signing exists, automatic updates on the stable
channel.

**[Download the latest release](https://github.com/mediafranca/vera/releases/latest)**
from GitHub Releases. The **Linux** installer (AppImage or deb) does not
require code signing. The **Windows and macOS** installers are currently
published **unsigned**, labelled "(sin firmar)": obtaining an Authenticode
identity or Apple notarization is not currently feasible for Vera's
maintainer. The operating system will warn about this (SmartScreen or
Gatekeeper) before letting you open it; instructions for installing anyway are
in [Installing on Windows](docs/instalacion-windows.md#instalar-sin-firma) and
[Distributing Vera Desktop](docs/distribucion-escritorio.md#instalar-sin-firma).

Vera is still evolving quickly. While Windows and macOS builds are unsigned,
there are no automatic updates: check the
[latest release](https://github.com/mediafranca/vera/releases/latest) often,
read its notes and install it over the previous one. **Updating the program
does not replace the memory:** Windows, macOS and Linux keep the corpus outside
the application files and reopen the same database after the update.

On Windows, run `Vera Setup <version> (sin firmar).exe` again; there is no need
to uninstall first. The portable edition is the exception that needs care:
`VeraData` lives next to the executable, so replace the portable build inside
the same folder or keep that folder when moving it. Opening the new portable
build in another directory does not delete the previous memory, but Vera will
not find it there and will start as a fresh installation.

### From source

Requires Node.js 24 or later.

```sh
git clone https://github.com/mediafranca/vera.git
cd vera
npm install
cp .env.example .env          # set VERA_OWNER and VERA_OWNER_NAME
npm run build
npm run serve                 # http://127.0.0.1:4173
```

Before writing to your own instance, follow the
[portability](docs/portabilidad.md) guide: the initial identity determines who
signs the graph's operations, and it explains why you should **fork** before
cloning. Development also requires the Allium validator and the steps in
[CONTRIBUTING.md](CONTRIBUTING.md).

```sh
npm run spec
npm run typecheck
npm test
```

## Working with AI

Vera has no captive AI and does not require another subscription: any client
that speaks [MCP](https://modelcontextprotocol.io/) —Claude Code, Claude
Desktop, Codex, Gemini CLI, LM Studio and others— connects through the same
door and operates on the corpus with its own identity and credential. The full
guide, with the five connection values and a case for each way of deploying the
client, is in [Connecting an AI](docs/conectar-una-ia.md).

- **Local client:** connect over `stdio` or loopback; data does not need to go
  through a relay.
- **Remote client with a bearer token:** enable
  [Vera Conecta](https://vera.mediafranca.net/vera-conecta/), authorize an
  access from Vera Desktop and configure the URL
  `https://conecta.mediafranca.net/v/<id>/mcp`.
- **Client that requires OAuth:** not yet supported by Vera Conecta. The
  documentation says so explicitly instead of faking an integration.

Vera Conecta carries requests while Desktop is connected. It does not host a
copy of the graph. Cloudflare and the relay are part of the path and may
process content in transit, but the service does not persist pages, blocks,
prompts or MCP responses.

## Capturing from the browser

[Vera Clip](https://github.com/mediafranca/vera-clip) places selections and
articles directly into the local Vera. It acts as a tool delegated by the
owner —not as another author— through a revocable capability that only allows
capture. The ordinary path uses `localhost` and does not go through the
Internet; [Vera Conecta](https://vera.mediafranca.net/vera-conecta/) is the
fallback when the browser is on another computer. The guide is in
[Vera Clip: capturing into the local Vera](docs/vera-clip.md).

## Accessibility

Vera targets [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA for its web
and desktop interface. It does **not** yet claim conformance: no full audit
has been carried out.

Current practice: native semantic HTML elements (`<button>`, `<nav>`,
`<input type="search">`) instead of custom widgets, ARIA attributes where
native semantics fall short, visible focus styles and respect for
`prefers-reduced-motion`. Known gap: reparenting a block by dragging its
bullet has no keyboard equivalent yet. Accessibility barriers are treated as
defects; please report them as [issues](https://github.com/mediafranca/vera/issues/new/choose).

## Code documentation

The [technical index](docs/README.md) gathers implementation architecture, MCP
connection, portability, exposure, test obligations and work plans. The
[Allium specifications](specs/) are the source of truth for behaviour. Most
technical documentation is in Spanish.

## Get involved

Vera needs people to test the application, describe defects, improve the
documentation, check the specifications and contribute code. You do not have to
start by programming:

- use [Discussions](https://github.com/mediafranca/vera/discussions) for
  questions, early proposals and design conversations;
- open an [issue](https://github.com/mediafranca/vera/issues/new/choose) when
  there is a reproducible defect or a sufficiently defined task;
- read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request: every
  ordinary PR targets `dev` and must preserve the Allium guarantees;
- see [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made,
  [SUPPORT.md](SUPPORT.md) for getting help and
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community rules.

Security reports follow a private channel described in [SECURITY.md](SECURITY.md).

## Related projects

[Vera Conecta](https://vera.mediafranca.net/vera-conecta/) is the shared bridge
between a local Vera installation and MCP clients on the Internet, with no open
ports, public IP or Tailscale. It lives in its own repository because it is
network infrastructure with its own deployment cycle. The relay and its Desktop
interface are tested end to end, and the community service runs at
[conecta.mediafranca.net](https://conecta.mediafranca.net). The
[code and technical contract](https://github.com/mediafranca/vera-conecta)
remain open; each installation keeps its corpus locally and authorizes each
remote client separately.

## License

Vera is released under [GNU AGPL-3.0-only](LICENSE). See also
[LICENCIA.md](LICENCIA.md), [AUTHORS.md](AUTHORS.md),
[CONTRIBUTING.md](CONTRIBUTING.md) and [NOTICE](NOTICE).

<p align="center">
  <img src="https://vera.mediafranca.net/assets/raised-fist.svg" width="104" alt="Raised fist">
</p>

<p align="center"><strong>Digital sovereignty</strong></p>

<p align="center">
  <small>Raised fist: Eugenio Hansen, OFS — own work,
  <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, via
  <a href="https://commons.wikimedia.org/w/index.php?curid=65787095">Wikimedia Commons</a>.</small>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mediafranca/mediafranca.github.io/refs/heads/main/assets/logo/mf.svg" width="72" alt="MediaFranca">
</p>

<p align="center">Vera is part of <a href="https://mediafranca.net/">MediaFranca</a>.</p>
