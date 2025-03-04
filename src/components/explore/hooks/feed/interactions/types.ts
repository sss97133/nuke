
export interface InteractionOptions {
  contentId: string;
  contentType: string;
  interactionType: 'view' | 'like' | 'share' | 'save' | 'comment';
}

export interface InteractionResponse {
  success: boolean;
  message?: string;
}
