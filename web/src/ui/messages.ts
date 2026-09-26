/** Loading, error and unsupported-browser overlay. Never a blank page. */
export interface Messages {
  loading(text: string): void;
  error(text: string, retry: () => void): void;
  unsupported(missing: string[]): void;
  hide(): void;
}

export function createMessages(root: HTMLElement): Messages {
  const el = document.createElement("div");
  el.className = "overlay";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  root.appendChild(el);

  const show = (...children: Node[]) => {
    el.replaceChildren(...children);
    el.hidden = false;
  };
  const p = (text: string, cls?: string) => {
    const n = document.createElement("p");
    n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };

  return {
    loading(text) {
      const spinner = document.createElement("div");
      spinner.className = "spinner";
      show(spinner, p(text));
    },
    error(text, retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = "Retry";
      button.addEventListener("click", retry, { once: true });
      show(p("Something went wrong loading the robot.", "title"), p(text, "detail"), button);
    },
    unsupported(missing) {
      show(
        p("This browser can't run the demo.", "title"),
        p(
          `It needs ${missing.join(", ")}. Try a recent Chrome, Safari, Firefox or Edge.`,
          "detail",
        ),
      );
    },
    hide() {
      el.hidden = true;
    },
  };
}
