export interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  onClick?: () => void;
}

/** Render a button element as an HTML string (framework-agnostic) */
export function renderButton(props: ButtonProps): string {
  const { label, variant = "primary", disabled = false } = props;
  const classes = `btn btn-${variant}${disabled ? " btn-disabled" : ""}`;
  return `<button class="${classes}"${disabled ? " disabled" : ""}>${label}</button>`;
}
