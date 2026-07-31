// Contratos sem implementação externa. Provedores futuros devem respeitar esta interface.
export class EmailProvider {
  async sendQuote(_message) { throw new Error('EmailProvider não configurado.'); }
}

export class WhatsAppProvider {
  async sendQuote(_message) { throw new Error('WhatsAppProvider não configurado.'); }
}

