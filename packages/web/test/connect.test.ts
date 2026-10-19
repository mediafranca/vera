// Lo que la página de la puerta dicta para conectar una IA de otro equipo.
//
// La configuración no se escribe a mano en ninguna parte: se arma de los datos
// de este despliegue. Lo que se prueba aquí es que armarla no invente nada y que
// cambiar cómo arranca la puerta cambie las dos formas a la vez.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clientRecipe, credentialState, publicLaunch, remoteLaunch } from '../src/mcp-page.ts';
import type { MCPConnect } from '../src/api.ts';

const connect = (overrides: Partial<MCPConnect> = {}): MCPConnect => ({
  transport: 'stdio',
  command: '/usr/bin/node',
  args: ['--experimental-strip-types', '--no-warnings', '/home/quien/vera/packages/mcp/src/main.ts'],
  cwd: '/home/quien/vera',
  url: 'http://127.0.0.1:4173',
  reachableAt: 'https://vera.una-tailnet.ts.net',
  node: 'v24.18.0',
  login: 'quien@maquina',
  remoteCredential: null,
  present: true,
  ...overrides,
});

describe('la configuración para otro equipo', () => {
  it('lanza ssh contra este equipo, y no node', () => {
    // El proceso corre aquí: por eso no hay que instalar nada allá.
    const said = JSON.parse(remoteLaunch(connect(), 'claude-desktop'));
    assert.equal(said.mcpServers.vera.command, '/usr/bin/ssh');
    assert.ok(said.mcpServers.vera.args.includes('quien@maquina'));
  });

  it('la orden remota es la misma línea que se lanzaría aquí', () => {
    const one = connect();
    const said = JSON.parse(remoteLaunch(one, 'claude-desktop'));
    const order = said.mcpServers.vera.args.at(-1);
    assert.ok(order.endsWith(`'${one.command}' ${one.args.map((arg) => `'${arg}'`).join(' ')}`));
  });

  it('cambiar cómo arranca la puerta cambia también esto', () => {
    // Se arma de `command` y `args` en vez de repetir las banderas, para que no
    // haya un segundo sitio que se quede atrás.
    const otro = connect({ command: '/opt/node', args: ['--flamante', '/otra/main.ts'] });
    const order = JSON.parse(remoteLaunch(otro, 'x')).mcpServers.vera.args.at(-1);
    assert.ok(order.includes("'/opt/node' '--flamante' '/otra/main.ts'"));
  });

  it('lleva el nombre del cliente, que es lo único que se decide', () => {
    const order = JSON.parse(remoteLaunch(connect(), 'otro')).mcpServers.vera.args.at(-1);
    assert.ok(order.startsWith("VERA_CLIENT='otro' "));
  });

  it('dicta TOML nativo para Codex y evita confirmaciones redundantes', () => {
    const said = remoteLaunch(connect(), 'codex-andrei');
    assert.match(said, /^\[mcp_servers\.vera\]/);
    assert.match(said, /default_tools_approval_mode = "auto"/);
    assert.match(said, /required = true/);
  });

  it('abre en Alexei una credencial cifrada declarada, sin copiar el secreto', () => {
    const said = remoteLaunch(
      connect({
        remoteCredential: {
          client: 'codex-andrei',
          file: '/seguro/vera-codex.cred',
          name: 'vera-codex',
        },
      }),
      'codex-andrei',
    );
    assert.match(said, /VERA_SYSTEMD_CREDENTIAL_FILE='\/seguro\/vera-codex\.cred'/);
    assert.match(said, /VERA_SYSTEMD_CREDENTIAL_NAME='vera-codex'/);
    assert.ok(!said.includes('VERA_TOKEN='));
  });

  it('el nombre del cliente no puede convertirse en una orden del shell remoto', () => {
    const order = JSON.parse(remoteLaunch(connect(), "otro'; touch /tmp/nope; '"))
      .mcpServers.vera.args.at(-1);
    assert.match(order, /^VERA_CLIENT='otro'"'"'; touch \/tmp\/nope; '"'"'' /);
  });

  it('no lleva VERA_URL: el proceso nace al lado de Vera', () => {
    // Ponerla sería apuntar a la dirección de fuera desde dentro de casa, que es
    // el rodeo que esta forma existe para evitar.
    assert.ok(!remoteLaunch(connect(), 'x').includes('VERA_URL'));
  });

  it('falla en vez de esperar una contraseña que nadie puede escribir', () => {
    // Una app sin terminal no tiene dónde preguntarla: sin BatchMode, ssh se
    // queda colgado y el cliente informa de un servidor que no arrancó.
    const args = JSON.parse(remoteLaunch(connect(), 'x')).mcpServers.vera.args;
    assert.ok(args.includes('BatchMode=yes'));
  });
});

describe('la configuración HTTPS pública', () => {
  it('entrega un JSON MCP completo y autenticado para Hermes', () => {
    const said = JSON.parse(
      publicLaunch('https://vera.mediafranca.net/mcp', 'hermes-andrei', 'secreto'),
    );
    assert.equal(said.mcpServers.vera.url, 'https://vera.mediafranca.net/mcp');
    assert.equal(said.mcpServers.vera.headers.Authorization, 'Bearer secreto');
    assert.equal(said.mcpServers.vera.headers['X-Vera-Client'], 'hermes-andrei');
    assert.equal(said.mcpServers.vera.command, undefined);
  });

  it('Codex distingue el formulario visual del TOML', () => {
    const made = clientRecipe('codex', 'https://vera.example/mcp', 'codex-andrei', 'secreto');
    assert.equal(made.tokenSeparate, true);
    assert.match(made.recipe, /bearer_token_env_var = "VERA_MCP_TOKEN"/);
    assert.match(made.recipe, /X-Vera-Client/);
    assert.ok(!made.recipe.includes('secreto'));
    assert.deepEqual(made.visual, {
      name: 'vera',
      transport: 'HTTP secuenciable',
      url: 'https://vera.example/mcp',
      bearerTokenEnvironmentVariable: '',
      headers: [
        { name: 'Authorization', value: 'Bearer secreto' },
        { name: 'X-Vera-Client', value: 'codex-andrei' },
      ],
      environmentHeaders: [],
    });
  });

  it('ChatGPT no recibe una receta Bearer que no puede ejecutar', () => {
    const made = clientRecipe('chatgpt', 'https://vera.example/mcp', 'chatgpt-andrei', 'secreto');
    assert.match(made.recipe, /no puede presentar esta credencial Bearer fija/);
    assert.match(made.recipe, /OAuth 2\.1 o Secure MCP Tunnel/);
    assert.ok(!made.recipe.includes('secreto'));
  });
});

describe('el estado de un acceso', () => {
  it('no llama conectada a una credencial activa', () => {
    assert.equal(credentialState({ status: 'active', lastUsedAt: null }).label, 'activa · nunca usada');
  });

  it('distingue el uso real y la revocación', () => {
    assert.match(credentialState({ status: 'active', lastUsedAt: Date.now() }).label, /^activa · usada /);
    assert.equal(credentialState({ status: 'revoked', lastUsedAt: null }).label, 'revocada');
  });
});
