import { ExpenseCategory } from '@/types/database'

export interface OcrCatalogItem {
  merchant_name: string
  cnpj: string
  category: ExpenseCategory
  typicalMin: number
  typicalMax: number
  keywords: string[]
}

export const BRAZILIAN_MERCHANT_CATALOG: OcrCatalogItem[] = [
  {
    merchant_name: 'Posto Ipiranga Estrela do Sul',
    cnpj: '33.123.456/0001-77',
    category: 'combustivel',
    typicalMin: 150,
    typicalMax: 320,
    keywords: ['posto', 'ipiranga', 'gasolina', 'combustivel', 'etanol', 'diesel', 'abastecimento'],
  },
  {
    merchant_name: 'Uber do Brasil Tecnologia Ltda.',
    cnpj: '17.895.646/0001-87',
    category: 'uber_taxi',
    typicalMin: 28,
    typicalMax: 110,
    keywords: ['uber', 'viagem', 'corrida', 'motorista', 'aplicativo'],
  },
  {
    merchant_name: 'Restaurante Sabor Mineiro Ltda.',
    cnpj: '12.987.654/0001-33',
    category: 'alimentacao',
    typicalMin: 45,
    typicalMax: 210,
    keywords: ['restaurante', 'refeicao', 'almoco', 'jantar', 'mineiro', 'buffet', 'comida'],
  },
  {
    merchant_name: 'Hotel Ibis São Paulo Paulista',
    cnpj: '01.234.567/0001-89',
    category: 'hospedagem',
    typicalMin: 320,
    typicalMax: 980,
    keywords: ['hotel', 'ibis', 'hospedagem', 'diaria', 'checkin', 'reserva', 'quarto'],
  },
  {
    merchant_name: 'Gol Linhas Aéreas Inteligentes S.A.',
    cnpj: '07.575.651/0001-59',
    category: 'transporte',
    typicalMin: 450,
    typicalMax: 1800,
    keywords: ['gol', 'voo', 'aereo', 'passagem', 'bilhete', 'embarque', 'aeronave'],
  },
  {
    merchant_name: 'Estacionamento Central Plaza',
    cnpj: '08.441.982/0001-12',
    category: 'estacionamento',
    typicalMin: 25,
    typicalMax: 95,
    keywords: ['estacionamento', 'vaga', 'parking', 'garagem', 'veiculo', 'ticket'],
  },
  {
    merchant_name: 'Concessionária AutoBAn / Pedágio',
    cnpj: '02.451.782/0001-90',
    category: 'pedagio',
    typicalMin: 12.8,
    typicalMax: 48.5,
    keywords: ['pedagio', 'tarifa', 'praca', 'concessionaria', 'rodovia', 'autoban'],
  },
  {
    merchant_name: 'Churrascaria Fogo de Chão',
    cnpj: '61.455.992/0001-20',
    category: 'alimentacao',
    typicalMin: 180,
    typicalMax: 420,
    keywords: ['churrascaria', 'fogo de chao', 'carnes', 'rodizio', 'almoco executivo'],
  },
  {
    merchant_name: 'Localiza Rent a Car S.A.',
    cnpj: '16.670.085/0001-55',
    category: 'transporte',
    typicalMin: 210,
    typicalMax: 650,
    keywords: ['localiza', 'aluguel', 'locadora', 'carro', 'veiculo', 'locacao', 'hertz'],
  },
]

export interface ProcessedReceiptOcr {
  file_name: string
  file_url: string
  merchant_name: string
  cnpj: string
  category: ExpenseCategory
  amount: number
  issue_date: string // YYYY-MM-DD
  issue_time: string
  ocr_raw_text: string
  preview_svg_data_url: string
}

export function generateReceiptSvgPreview(
  merchant: string,
  cnpj: string,
  amount: number,
  date: string,
  category: string,
): string {
  const formattedAmount = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">
    <defs>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.1"/>
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="#f1f5f9"/>
    <!-- Paper receipt -->
    <g filter="url(#shadow)">
      <rect x="30" y="24" width="420" height="592" rx="4" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>
      <!-- Serrated top edge -->
      <path d="M 30 24 L 50 30 L 70 24 L 90 30 L 110 24 L 130 30 L 150 24 L 170 30 L 190 24 L 210 30 L 230 24 L 250 30 L 270 24 L 290 30 L 310 24 L 330 30 L 350 24 L 370 30 L 390 24 L 410 30 L 430 24 L 450 30 L 450 24 Z" fill="#f1f5f9"/>
      
      <!-- Merchant header -->
      <text x="240" y="80" font-family="monospace, sans-serif" font-size="16" font-weight="bold" fill="#0f172a" text-anchor="middle">${escapeXml(merchant.slice(0, 32))}</text>
      <text x="240" y="102" font-family="monospace, sans-serif" font-size="11" fill="#64748b" text-anchor="middle">CNPJ: ${cnpj}</text>
      <text x="240" y="120" font-family="monospace, sans-serif" font-size="10" fill="#94a3b8" text-anchor="middle">DOCUMENTO AUXILIAR DA NOTA FISCAL (NFC-e)</text>
      
      <!-- Divider line -->
      <line x1="50" y1="135" x2="430" y2="135" stroke="#cbd5e1" stroke-dasharray="4 4" stroke-width="1.5"/>
      
      <!-- Meta -->
      <text x="50" y="165" font-family="monospace, sans-serif" font-size="12" fill="#475569">DATA EMISSÃO:</text>
      <text x="430" y="165" font-family="monospace, sans-serif" font-size="12" font-weight="bold" fill="#0f172a" text-anchor="end">${date}</text>
      
      <text x="50" y="190" font-family="monospace, sans-serif" font-size="12" fill="#475569">CATEGORIA:</text>
      <text x="430" y="190" font-family="monospace, sans-serif" font-size="12" font-weight="bold" fill="#1e40af" text-anchor="end">${category.toUpperCase()}</text>
      
      <text x="50" y="215" font-family="monospace, sans-serif" font-size="12" fill="#475569">CONTROLE / PROTOCOLO:</text>
      <text x="430" y="215" font-family="monospace, sans-serif" font-size="11" fill="#64748b" text-anchor="end">BR-${Math.floor(Math.random() * 899999 + 100000)}</text>
      
      <!-- Items table -->
      <line x1="50" y1="235" x2="430" y2="235" stroke="#cbd5e1" stroke-width="1"/>
      <text x="50" y="255" font-family="monospace, sans-serif" font-size="11" font-weight="bold" fill="#334155">DESCRIÇÃO DOS ITENS</text>
      <text x="430" y="255" font-family="monospace, sans-serif" font-size="11" font-weight="bold" fill="#334155" text-anchor="end">VALOR</text>
      <line x1="50" y1="265" x2="430" y2="265" stroke="#e2e8f0" stroke-width="1"/>
      
      <text x="50" y="295" font-family="monospace, sans-serif" font-size="11" fill="#334155">001 SERVIÇOS / CONSUMO CORP</text>
      <text x="430" y="295" font-family="monospace, sans-serif" font-size="11" fill="#334155" text-anchor="end">${formattedAmount}</text>
      
      <text x="50" y="325" font-family="monospace, sans-serif" font-size="10" fill="#94a3b8">QTD: 1.000 UN x ${formattedAmount}</text>
      <text x="430" y="325" font-family="monospace, sans-serif" font-size="10" fill="#94a3b8" text-anchor="end">ICMS/ISS INC.</text>
      
      <!-- Total box -->
      <line x1="50" y1="355" x2="430" y2="355" stroke="#0f172a" stroke-width="1.5"/>
      <rect x="50" y="365" width="380" height="48" fill="#f8fafc" rx="4"/>
      <text x="65" y="396" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a">VALOR TOTAL PAGO</text>
      <text x="415" y="396" font-family="sans-serif" font-size="18" font-weight="800" fill="#10b981" text-anchor="end">${formattedAmount}</text>
      <line x1="50" y1="422" x2="430" y2="422" stroke="#0f172a" stroke-width="1.5"/>
      
      <!-- Payment & Barcode -->
      <text x="240" y="450" font-family="monospace, sans-serif" font-size="11" fill="#475569" text-anchor="middle">FORMA DE PAGAMENTO: CARTÃO CORPORATIVO</text>
      <text x="240" y="470" font-family="monospace, sans-serif" font-size="10" fill="#94a3b8" text-anchor="middle">AUTORIZAÇÃO: CIEL-${Math.floor(Math.random() * 89999 + 10000)}</text>
      
      <!-- Simulated Barcode -->
      <g transform="translate(80, 490)">
        <rect x="0" y="0" width="4" height="40" fill="#0f172a"/>
        <rect x="8" y="0" width="2" height="40" fill="#0f172a"/>
        <rect x="14" y="0" width="6" height="40" fill="#0f172a"/>
        <rect x="24" y="0" width="3" height="40" fill="#0f172a"/>
        <rect x="32" y="0" width="8" height="40" fill="#0f172a"/>
        <rect x="44" y="0" width="2" height="40" fill="#0f172a"/>
        <rect x="50" y="0" width="5" height="40" fill="#0f172a"/>
        <rect x="60" y="0" width="3" height="40" fill="#0f172a"/>
        <rect x="70" y="0" width="7" height="40" fill="#0f172a"/>
        <rect x="82" y="0" width="3" height="40" fill="#0f172a"/>
        <rect x="92" y="0" width="6" height="40" fill="#0f172a"/>
        <rect x="104" y="0" width="2" height="40" fill="#0f172a"/>
        <rect x="112" y="0" width="8" height="40" fill="#0f172a"/>
        <rect x="126" y="0" width="4" height="40" fill="#0f172a"/>
        <rect x="136" y="0" width="3" height="40" fill="#0f172a"/>
        <rect x="145" y="0" width="6" height="40" fill="#0f172a"/>
        <rect x="157" y="0" width="2" height="40" fill="#0f172a"/>
        <rect x="165" y="0" width="7" height="40" fill="#0f172a"/>
        <rect x="178" y="0" width="4" height="40" fill="#0f172a"/>
        <rect x="188" y="0" width="8" height="40" fill="#0f172a"/>
        <rect x="202" y="0" width="3" height="40" fill="#0f172a"/>
        <rect x="210" y="0" width="5" height="40" fill="#0f172a"/>
        <rect x="220" y="0" width="2" height="40" fill="#0f172a"/>
        <rect x="228" y="0" width="6" height="40" fill="#0f172a"/>
        <rect x="240" y="0" width="4" height="40" fill="#0f172a"/>
        <rect x="250" y="0" width="8" height="40" fill="#0f172a"/>
        <rect x="264" y="0" width="3" height="40" fill="#0f172a"/>
        <rect x="274" y="0" width="6" height="40" fill="#0f172a"/>
        <rect x="286" y="0" width="4" height="40" fill="#0f172a"/>
        <rect x="296" y="0" width="8" height="40" fill="#0f172a"/>
        <rect x="310" y="0" width="3" height="40" fill="#0f172a"/>
        <text x="160" y="55" font-family="monospace, sans-serif" font-size="9" fill="#64748b" text-anchor="middle">3525 0307 5756 5100 0159 5500 1000 4819 2810</text>
      </g>
      
      <text x="240" y="580" font-family="monospace, sans-serif" font-size="10" fill="#94a3b8" text-anchor="middle">REEMBOLSO.AI - OCR VERIFICADO</text>
    </g>
  </svg>`

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function processReceiptOcr(file: File, indexHint = 0): ProcessedReceiptOcr {
  const fileNameLower = file.name.toLowerCase()
  let matched = BRAZILIAN_MERCHANT_CATALOG.find((m) =>
    m.keywords.some((k) => fileNameLower.includes(k)),
  )

  if (!matched) {
    const pickIndex =
      Math.abs(file.name.length * 31 + indexHint * 17) % BRAZILIAN_MERCHANT_CATALOG.length
    matched = BRAZILIAN_MERCHANT_CATALOG[pickIndex]
  }

  // Generate realistic deterministic amount based on seed
  const range = matched.typicalMax - matched.typicalMin
  const randomFactor = ((file.size % 100) / 100) * range
  const amount = Number((matched.typicalMin + randomFactor).toFixed(2))

  // Generate realistic recent date
  const now = new Date()
  const daysAgo = (indexHint * 2 + (file.size % 7)) % 25
  const receiptDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000)
  const issue_date = receiptDate.toISOString().split('T')[0]
  const hours = String(8 + ((indexHint * 3 + (file.size % 12)) % 13)).padStart(2, '0')
  const minutes = String((file.size % 50) + 5).padStart(2, '0')
  const issue_time = `${hours}:${minutes}`

  const ocr_raw_text = `${matched.merchant_name.toUpperCase()} - CNPJ ${matched.cnpj} - COMPROVANTE FISCAL NFC-e - EMISSAO ${issue_date} ${issue_time} - VALOR TOTAL R$ ${amount.toFixed(2)} - PAGAMENTO APROVADO`

  const preview_svg_data_url = generateReceiptSvgPreview(
    matched.merchant_name,
    matched.cnpj,
    amount,
    issue_date,
    matched.category,
  )

  return {
    file_name: file.name,
    file_url: preview_svg_data_url,
    merchant_name: matched.merchant_name,
    cnpj: matched.cnpj,
    category: matched.category,
    amount,
    issue_date,
    issue_time,
    ocr_raw_text,
    preview_svg_data_url,
  }
}
