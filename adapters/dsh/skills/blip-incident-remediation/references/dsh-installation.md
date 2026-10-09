# Instalação nativa e renderer

Este pacote é registrado por `adapters/dsh/plugin-skills.mjs`. Nas imagens Hive e DSH ele fica em `/voidr-plugin/adapters/dsh/skills/blip-incident-remediation/`. Use a base efetivamente devolvida pela ferramenta `skill`, sem depender do diretório da conversa.

O pacote preserva todos os arquivos canônicos, exceto `__pycache__`. O bloco inicial e os arquivos `dsh-*` adaptam descoberta, preflight e dependências; não substituem a investigação. `agents/openai.yaml` permanece metadado de origem, sem consumidor equivalente no Harness.

Para instalação independente, copie o pacote para `<DSH_HOME>/skills/blip-incident-remediation/`, sem caches. Uma cópia local ou de projeto pode prevalecer sobre a embarcada; confirme o `resourceBase` da ferramenta.

## Python isolado

As imagens instalam as dependências em `/opt/voidr/blip-pdf`, cujo Python está no `PATH`. Não instale dependências durante a investigação. Numa instalação local independente, crie um venv e instale `scripts/requirements-dsh.txt`; não altere o Python global.

```bash
/opt/voidr/blip-pdf/bin/python3 -m pip check
/opt/voidr/blip-pdf/bin/python3 scripts/render_blip_postmortem.py INPUT.json OUTPUT.pdf
```

Execute na base da skill e salve o PDF no workspace autorizado, não na árvore do pacote. O script resolve assets pela sua própria localização, inclusive quando chamado de outro diretório. `pdftoppm` está disponível nas imagens para conferir todas as páginas. As versões são `pypdf 6.10.0` e `reportlab 4.4.9`.

## Smoke reproduzível sem LLM nem serviços remotos

Na raiz da skill:

```bash
node scripts/smoke_dsh.mjs NODE_MODULES CANONICAL_SKILL_DIR
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_dsh_preflight.py
```

O smoke verifica a instalação filesystem no registry real, ativação, catálogo, caminhos e preservação canônica. Os testes do plugin verificam a instalação embarcada. Nenhum desses testes prova autenticação, MFA, VPN ou consultas aos backends. O preflight operacional exige operações reais no contexto Blip; inventário bem-sucedido continua sendo apenas smoke de catálogo.

O template de preflight tem timestamp vazio por intenção: precisa ser preenchido após a checagem real. Os testes usam evidências sintéticas somente em memória, que não valem como preflight operacional.

Nas builds das imagens, `tools/dsh/smoke-blip-skill.mjs` do Hive valida o pacote
com o registry real do Harness, ativação explícita e catálogo. Depois executa
`scripts/smoke_renderer.py` com `pypdf` e `reportlab`, sem LLM nem provedores.
Esse gate ocorre antes do push das imagens Hive e DSH.
