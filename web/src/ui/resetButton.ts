/** One-action reset to the default pose (FR-006). */
export function createResetButton(toolbar: HTMLElement, onReset: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = "Reset";
  button.dataset.short = "↺";
  button.setAttribute("aria-label", "Reset");
  button.title = "Return the arm to its starting pose";
  button.addEventListener("click", onReset);
  toolbar.appendChild(button);
  return button;
}
