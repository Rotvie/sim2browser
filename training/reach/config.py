"""Training-only settings: reward weights and target sampling. Not parity-critical (the browser
never reads these); everything the policy observes or does lives in shared/parity.json."""

from dataclasses import dataclass


@dataclass(frozen=True)
class RewardWeights:
    distance: float = 1.0  # −distance(tip, target) per step, meters
    success_bonus: float = 0.5  # per step while settled (parity.json `success`)
    # Sharpens the signal near the target, where −distance alone is flat: w · (1 − tanh(d / scale)).
    precision: float = 0.5
    precision_scale: float = 0.02
    action_rate: float = 0.02  # −w · ‖aₜ − aₜ₋₁‖²
    jerk: float = 2e-4  # −w · ‖tip jerk‖² (m/s³)²
    # −w · ‖q̇‖²: discourages motion that does not move the tip (e.g. spinning Wrist_Roll, which
    # neither the distance nor the tip-jerk terms can see). Off by default; used from round 3.
    joint_speed: float = 0.0
    # −w · ‖q − neutral‖²: a preferred posture, the learned counterpart of the baseline's
    # null-space pull. Without it Wrist_Roll (invisible to the tip) drifts to its limit. Round 4 on.
    posture: float = 0.0
    # −w · ‖a‖²: small cost for commanding motion that does not help. Round 4 on.
    effort: float = 0.0
    # 003 (contacts): on steps with an arm contact the jerk term uses min(‖jerk‖², jerk_cap), so an
    # impact costs at most w_jerk · jerk_cap per step instead of swamping the reward. Free motion
    # pays the full ‖jerk‖².
    jerk_cap: float = 5000.0
    # −w per control step in which an arm body touches the floor / the cube (not ramped).
    floor: float = 1.0
    cube: float = 0.5


@dataclass(frozen=True)
class Sampling:
    episode_steps: int = 250  # 5 s at 50 Hz
    min_target_changes: int = 1
    max_target_changes: int = 3
    p_unreachable_far: float = 0.05  # beyond maxReach from the shoulder
    p_unreachable_behind: float = 0.05  # behind the base (outside the front workspace)
    p_moving_target: float = 0.5  # target glides to its new position (like a drag)
    p_random_start: float = 0.5  # start from a random pose instead of neutral + noise
    # 003: the cube during reach training. At its default pose (the evaluation's) with this
    # probability; otherwise uniform by area in an annulus sector in front of the arm.
    p_cube_default: float = 0.2
    cube_r: tuple[float, float] = (0.08, 0.40)
    cube_max_angle: float = 1.396  # 80°
    # Targets are resampled while inside the cube's box grown by this margin (m).
    target_cube_margin: float = 0.04


REWARD = RewardWeights()
SAMPLING = Sampling()
