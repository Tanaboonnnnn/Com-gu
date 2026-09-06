// Sleeping workers reuse their exact ChatGPT conversation. A deferred revival marker names the
// command and conversation, while command text remains app-side until the page wins redeem authority.
export interface RevivalMarker {
  commandId: string;
  conversationId: string;
}

export function sameRevivalTarget(left: RevivalMarker, right: RevivalMarker): boolean {
  return left.conversationId === right.conversationId;
}
