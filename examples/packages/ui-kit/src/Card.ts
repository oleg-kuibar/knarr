export interface CardProps {
  title: string;
  body: string;
  footer?: string;
}

/** Render a card component as an HTML string (framework-agnostic) */
export function renderCard(props: CardProps): string {
  const { title, body, footer } = props;
  return [
    `<div class="card">`,
    `  <div class="card-header">${title}</div>`,
    `  <div class="card-body">${body}</div>`,
    footer ? `  <div class="card-footer">${footer}</div>` : "",
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}
