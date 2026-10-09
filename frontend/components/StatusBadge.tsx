"use client";

interface Props {
  status: string;
  className?: string;
}

const LABELS: Record<string, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  held: "Held",
  escalated: "Escalated",
  executed: "Executed",
  cancelled: "Cancelled",
  active: "Active",
  suspended: "Suspended",
  draft: "Draft",
  pending_activation: "Pending Activation",
  committed: "Committed",
  revealed: "Revealed",
  overdue: "Overdue",
  paid: "Paid",
  PAY: "Pay",
  PAY_EARLY: "Pay Early",
  HOLD: "Hold",
  NO_OP: "No-op",
  ESCALATE: "Escalate",
  approved: "Approved",
  rejected: "Rejected",
  complete: "Complete",
  attesting: "Attesting",
  minting: "Minting",
  burning: "Burning",
  stage1: "Stage 1",
  stage2: "Stage 2",
  stage3: "Stage 3",
  stage4: "Stage 4",
};

export default function StatusBadge({ status, className }: Props) {
  const key = status.toLowerCase().replace(/\s+/g, "-");
  return (
    <span className={`badge badge-${key} ${className ?? ""}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
