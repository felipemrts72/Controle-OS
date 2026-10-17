"""Validate the actual HTTP-produced catalog and quote PDFs, including image placement."""
import json
from pathlib import Path
from pypdf import PdfReader

root = Path('output/pdf')
expected = [
    'Britador de Mandíbula 30×20',
    'Britador compacto para redução primária de pedras e minérios.',
    'O Britador de Mandíbula 30×20 é indicado para a quebra e redução do material antes da etapa de moagem, preparando a granulometria para alimentação do moinho.',
    'Boca de britagem', '30 × 20 cm', 'Motor', '13 CV',
    'Base completa com adaptações necessárias',
    'Britagem de pedras, minérios e materiais de mineração, especialmente como etapa de preparação antes do moinho.',
    'Estrutura reforçada', 'Equipamento completo com motor', 'Versão 3',
]
results = []
for filename, pages in [('britador-30x20-catalogo.pdf', 1), ('britador-30x20-orcamento-preview.pdf', 2)]:
    reader = PdfReader(root / filename)
    assert len(reader.pages) == pages
    page = reader.pages[-1]
    text = ' '.join(page.extract_text().split())
    for phrase in expected:
        assert phrase in text, (filename, phrase)
    assert all(word not in text.lower() for word in ['bateria', 'partida', 'capacidade', 'peso'])
    # The corporate header logo remains; there must be no equipment image.
    assert len(list(page.images)) == 1, 'Only the company logo should be embedded'
    positions = []
    page.extract_text(visitor_text=lambda text, cm, tm, font, size: positions.append((text, tm[5])))
    spec_y = next(y for text, y in positions if 'Boca de britagem' in text)
    assert spec_y > 550, 'Specifications must move up without an empty image block'
    (root / filename.replace('.pdf', '.txt')).write_text('\n\n'.join(p.extract_text() for p in reader.pages), encoding='utf-8')
    results.append({'file': filename, 'pages': pages, 'bytes': (root / filename).stat().st_size, 'expected_texts': len(expected), 'equipment_images': 0, 'company_logos': 1, 'specification_pdf_y': spec_y})
(root / 'britador-validacao-pdf.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(results, ensure_ascii=True, indent=2))
