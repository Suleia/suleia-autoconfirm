export function buildConversationMessages(order, chatMessages) {
  const intro = [
    {
      role: 'system',
      content: 'Clasifica la respuesta del cliente a una confirmación de pedido COD y devuelve un JSON con intent, confidence y reason.'
    }
  ];

  const lines = [];
  lines.push(`[tienda] Pedido ${order.orderId} para ${order.customerName || 'cliente'} por ${order.orderAmount ?? 'importe desconocido'}${order.currencyCode ? ` ${order.currencyCode}` : ''}.`);
  for (const message of chatMessages) {
    lines.push(`[${message.role}] ${message.content}`);
  }

  return [
    ...intro,
    {
      role: 'user',
      content: lines.join('\n')
    }
  ];
}
