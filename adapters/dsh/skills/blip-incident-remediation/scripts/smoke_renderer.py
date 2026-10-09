import json
from pathlib import Path
import subprocess
import sys
import tempfile

from pypdf import PdfReader


def smoke(output):
    output.mkdir(parents=True, exist_ok=True)
    fields = ['Data/hora de início', 'Data/hora da correção', 'Duração do incidente',
              'Registro do incidente interno', 'Sistema/Aplicação/Infraestrutura envolvida',
              'Sintomas identificados', 'Impacto', 'Causa raiz']
    data = {
        'title': 'SMOKE SINTÉTICO DO RENDERER',
        'classification': 'INTERNA — RASCUNHO', 'partial': True,
        'status': 'TESTE TÉCNICO — NÃO É UM INCIDENTE',
        'conclusion': 'Fixture sintética: valida somente o pacote e a renderização; não prova acesso remoto.',
        'incident_info': {field: 'Não aplicável — fixture sintética' for field in fields},
        'events': [{'datetime': 'Não aplicável', 'event': 'Teste sintético de renderização', 'evidence': 'E1'}],
        'sections': {key: 'Não aplicável — fixture técnica, sem diagnóstico real.' for key in
                     ['root_cause', 'investigation', 'solution', 'result', 'future_actions']},
        'graph': {'title': 'Grafo sintético — não representa runtime',
                  'nodes': [{'id': 'fixture', 'label': 'Fixture sintética', 'state': 'LACUNA'}],
                  'edges': [], 'legend': 'Nenhum elo causal foi investigado.'},
        'evidence': [{'id': 'E1', 'claim': 'Conteúdo sintético para testar apresentação.',
                      'source': 'Fixture local', 'scope': 'Smoke', 'window': 'Não aplicável',
                      'method': 'Execução do renderer', 'state': 'LACUNA', 'link': 'indisponível'}],
        'causal_ladder': [{'level': 'Defeito iniciador', 'conclusion': 'Não aplicável — smoke',
                          'evidence': 'Não aplicável', 'confidence': 'Não determinada'}],
        'coverage': [{'family': 'Runtime', 'scope': 'Não consultado', 'query': 'Nenhuma',
                      'result': 'Não verificado', 'state': 'Não aplicável — fixture sintética'}],
        'limitations': 'Este teste não contém evidência de incidente ou de provedores.',
        'next_unlock': 'Executar o preflight real somente com input e escopo autorizados.',
    }
    source = output / 'blip-renderer-smoke.json'
    target = output / 'blip-renderer-smoke.pdf'
    source.write_text(json.dumps(data, ensure_ascii=False), encoding='utf8')
    subprocess.run([sys.executable, str(Path(__file__).with_name('render_blip_postmortem.py')),
                    str(source), str(target)], check=True)
    reader = PdfReader(target)
    assert len(reader.pages) >= 3
    for page in reader.pages:
        assert abs(float(page.mediabox.width) - 595.276) < 1
        assert abs(float(page.mediabox.height) - 841.89) < 1
    text = ' '.join('\n'.join(page.extract_text() or '' for page in reader.pages).split())
    for heading in ['SMOKE SINTÉTICO DO RENDERER', 'EVENTOS IMPORTANTES DO INCIDENTE',
                    'Livro de evidências', 'Matriz de cobertura', 'Próximo desbloqueio prioritário']:
        assert heading in text, heading
    print(json.dumps({'renderer': 'passed', 'pages': len(reader.pages), 'synthetic': True}))


if __name__ == '__main__':
    if len(sys.argv) == 2:
        smoke(Path(sys.argv[1]).resolve())
    else:
        with tempfile.TemporaryDirectory(prefix='blip-renderer-smoke-') as directory:
            smoke(Path(directory))
