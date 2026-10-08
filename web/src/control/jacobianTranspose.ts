/**
 * Example plug-in controller: Jacobian-transpose reaching, a classical law that needs no matrix
 * inverse:
 *
 *   Δq = α · Jᵀ e,   α = rate · ⟨e, JJᵀe⟩ / ‖JJᵀe‖² / Hz,   e = target − tip
 *
 * The step size α is the one that best reduces the error along Jᵀe (Buss & Kim), scaled to close
 * `rate` of the error per second. A fixed α either crawls near the target or oscillates.
 * It is less precise than the damped least-squares baseline and is here to show how little a
 * controller needs: read state from `sim`, write joint-target changes through `arm`.
 * Registered in registry.ts as a lab controller (`?lab` in the URL).
 */
import type { ControllerDef } from "./registry";

export const jacobianTranspose: ControllerDef = {
  id: "jacobian-transpose",
  label: "Jacobian T",
  short: "Jacobian transpose",
  description:
    "Example plug-in: Jacobian-transpose reaching (Δq = α·Jᵀe with an adaptive step). No matrix inverse; less precise than the baseline.",
  public: false,
  create({ sim, arm, parity, target }) {
    const rate = 5; // fraction of the error to close per second (same as the baseline gain)
    const hz = parity.controlHz;
    const maxPerStep = parity.baseline.maxJointSpeed / hz; // same speed limit as everyone
    const n = sim.nu;
    return {
      enter() {},
      step() {
        const tip = sim.sitePos(parity.tipSite);
        const t = target();
        const e = [t[0] - tip[0], t[1] - tip[1], t[2] - tip[2]];
        const J = sim.jacSiteJoints(parity.tipSite); // 3 × n, row-major
        const g = new Float64Array(n); // Jᵀe
        for (let j = 0; j < n; j++) g[j] = J[j] * e[0] + J[n + j] * e[1] + J[2 * n + j] * e[2];
        const Jg = [0, 1, 2].map((r) => g.reduce((s, gj, j) => s + J[r * n + j] * gj, 0)); // JJᵀe
        const denom = Jg[0] ** 2 + Jg[1] ** 2 + Jg[2] ** 2;
        if (denom < 1e-12) return; // at the target (or singular): hold
        const alpha = (rate * (e[0] * Jg[0] + e[1] * Jg[1] + e[2] * Jg[2])) / denom / hz;
        arm.applyDelta(
          g.map((gj) => alpha * gj),
          maxPerStep,
        );
      },
    };
  },
};
