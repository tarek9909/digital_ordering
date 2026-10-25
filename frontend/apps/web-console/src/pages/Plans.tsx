import { planCreateBody, priceCreateBody } from "@dop/contracts";
import { formatMoney } from "@dop/client-sdk";
import { useTranslation } from "@dop/i18n";
import {
  Button,
  EmptyState,
  Field,
  LiveRegion,
  Modal,
  PageShell,
  Spinner,
} from "@dop/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ErrorNote, FormButtons } from "../components/common";
import { api } from "../lib/api";
import { majorToMinor, minorToMajor } from "../lib/money";
import { DEFAULT_LIMITS } from "../lib/planLimits";
import type { Plan } from "../lib/types";

// Plans and prices (FR-SA-10). A new price replaces the active one for the same plan, period and currency.

type Dialog = { kind: "edit"; plan: Plan } | null;
const PERIODS = ["month", "quarter", "year"] as const;
const CURRENCY = "USD";

export function PlansPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [announce, setAnnounce] = useState("");
  const q = useQuery({
    queryKey: ["plans"],
    queryFn: () => api.get<{ items: Plan[] }>("/plans"),
  });
  const done = (msg: string) => {
    setDialog(null);
    setAnnounce(msg);
    void qc.invalidateQueries({ queryKey: ["plans"] });
  };
  const close = () => setDialog(null);
  // One plan only: the others are retired and never shown.
  const plans = (q.data?.items ?? []).filter((p) => p.code === "standard");

  return (
    <PageShell
      wide
      eyebrow={t("layout.groups.platform")}
      title={t("plans.title")}
      description={t("plans.description")}
    >
      <LiveRegion toast text={announce} />
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <div className="p-8 text-center">
          <Spinner label={t("common:loading")} />
        </div>
      ) : plans.length === 0 ? (
        <EmptyState title={t("plansUx.emptyTitle")}>
          {t("plansUx.emptyHint")}
        </EmptyState>
      ) : (
        <div className="grid gap-6">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} onDialog={setDialog} />
          ))}
        </div>
      )}
      {dialog?.kind === "edit" && (
        <Modal
          open
          onOpenChange={(o) => !o && close()}
          title={t("plans.editTitle", { code: dialog.plan.name })}
        >
          <div className="pt-2">
            <PlanForm
              plan={dialog.plan}
              onCancel={close}
              onDone={() => done(t("plans.updated"))}
            />
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

function PlanCard({
  plan,
  onDialog,
}: {
  plan: Plan;
  onDialog: (d: Dialog) => void;
}) {
  const { t, i18n } = useTranslation();
  const monthly = plan.prices.find(
    (x) => x.active && x.period === "month" && x.currency === CURRENCY,
  );

  return (
    <article
      aria-labelledby={`plan-${plan.id}`}
      className="grid overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-card lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <div className="ember-glow flex flex-col justify-between gap-10 bg-ink p-6 text-white sm:p-8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="eyebrow text-xs text-white/60">
              {t("plans.title")}
            </span>
            <h2
              id={`plan-${plan.id}`}
              className="font-display text-3xl font-extrabold tracking-tight"
            >
              {plan.name}
            </h2>
            <p className="max-w-sm text-sm text-white/70">
              {plan.description || t("plansUx.noDescription")}
            </p>
          </div>
          <Button
            variant="secondary"
            size="md"
            className="shrink-0 text-xs font-bold"
            onClick={() => onDialog({ kind: "edit", plan })}
          >
            {t("plans.edit")}
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-xs text-white/60">
            {t("period.month")}
          </span>
          <span
            dir="ltr"
            className="font-display text-5xl font-extrabold tracking-tight text-glow sm:text-6xl"
          >
            {monthly
              ? formatMoney(monthly.amountMinor, CURRENCY, i18n.language)
              : "—"}
          </span>
        </div>
      </div>
      <div className="p-6 sm:p-8">
        <PriceInputs plan={plan} />
      </div>
    </article>
  );
}

function PlanForm({
  plan,
  onCancel,
  onDone,
}: {
  plan?: Plan;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState(() => ({
    code: plan?.code ?? "",
    name: plan?.name ?? "",
    description: plan?.description ?? "",
  }));
  const [errs, setErrs] = useState<{ code?: string; name?: string }>({});
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      plan ? api.patch(`/plans/${plan.id}`, body) : api.post("/plans", body),
    onSuccess: onDone,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errs = {};
    // Limits and features are not edited here: a new plan starts from the defaults, an existing one keeps its own.
    const body = {
      code: v.code.trim(),
      name: v.name.trim(),
      description: v.description.trim(),
      isPublic: plan?.isPublic ?? true,
      limits: DEFAULT_LIMITS,
      features: [] as string[],
    };
    const r = planCreateBody.safeParse(body);
    if (!r.success) {
      for (const i of r.error.issues) {
        const k = i.path[0];
        if (k === "code" && !plan) next.code = t("plans.codeInvalid");
        if (k === "name") next.name = t("plans.nameInvalid");
      }
    }
    setErrs(next);
    if (Object.keys(next).length) return;
    const { code: _code, limits: _l, features: _f, ...patch } = body;
    m.mutate(plan ? patch : body);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <ErrorNote error={m.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("plans.name")}
          maxLength={80}
          value={v.name}
          error={errs.name}
          placeholder={t("plansUx.namePlaceholder")}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
        {!plan && (
          <Field
            label={t("plans.code")}
            dir="ltr"
            autoComplete="off"
            hint={t("plans.codeHint")}
            value={v.code}
            error={errs.code}
            placeholder="pro_plus"
            onChange={(e) =>
              setV({
                ...v,
                code: e.target.value.toLowerCase().replace(/[\s-]+/g, "_"),
              })
            }
          />
        )}
      </div>
      <Field
        label={t("plansUx.descriptionLabel")}
        maxLength={500}
        hint={t("plansUx.descriptionHint")}
        value={v.description}
        onChange={(e) => setV({ ...v, description: e.target.value })}
      />
      <FormButtons
        onCancel={onCancel}
        busy={m.isPending}
        label={t("common:save")}
      />
    </form>
  );
}

/** The three prices of the plan, in US dollars: one input each for month, quarter and year; saving replaces the active price. */
function PriceInputs({ plan }: { plan: Plan }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const current = (period: (typeof PERIODS)[number]) =>
    plan.prices.find(
      (x) => x.active && x.period === period && x.currency === CURRENCY,
    );
  const initial = () =>
    Object.fromEntries(
      PERIODS.map((p) => [
        p,
        current(p) ? minorToMajor(current(p)!.amountMinor) : "",
      ]),
    ) as Record<(typeof PERIODS)[number], string>;
  const [v, setV] = useState(initial);
  const [bad, setBad] = useState<
    Partial<Record<(typeof PERIODS)[number], boolean>>
  >({});
  const [saved, setSaved] = useState(false);
  const m = useMutation({
    mutationFn: async () => {
      for (const period of PERIODS) {
        const amountMinor = majorToMinor(v[period])!;
        if (current(period)?.amountMinor === amountMinor) continue;
        await api.post(
          `/plans/${plan.id}/prices`,
          priceCreateBody.parse({ period, currency: CURRENCY, amountMinor }),
        );
      }
    },
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["plans"] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const next = Object.fromEntries(
      PERIODS.map((p) => [p, majorToMinor(v[p]) === null]),
    ) as typeof bad;
    setBad(next);
    if (!Object.values(next).some(Boolean)) m.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <h3 className="eyebrow text-xs text-muted">
        {t("plans.prices")} · {CURRENCY}
      </h3>
      <ErrorNote error={m.error} />
      <div className="grid gap-4 sm:grid-cols-3">
        {PERIODS.map((period) => {
          const minor = majorToMinor(v[period]);
          return (
            <Field
              key={period}
              label={t(`period.${period}`)}
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={v[period]}
              hint={
                minor !== null
                  ? formatMoney(minor, CURRENCY, i18n.language)
                  : undefined
              }
              error={bad[period] ? t("plans.amountInvalid") : undefined}
              onChange={(e) => {
                setSaved(false);
                setV({ ...v, [period]: e.target.value });
              }}
            />
          );
        })}
      </div>
      <div className="flex justify-end border-t border-line pt-5">
        <Button type="submit" busy={m.isPending}>
          {saved ? t("plans.priceAdded") : t("common:save")}
        </Button>
      </div>
    </form>
  );
}
