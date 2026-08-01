import type { AssistantProductionPlan } from "./types";

function label(value: string) {
  return value.replaceAll("_", " ");
}

function activeStepId(plan: AssistantProductionPlan) {
  return plan.steps.find((step) => step.status === "in_progress")?.id
    ?? plan.steps.find((step) => step.status === "ready")?.id
    ?? plan.steps.find((step) => !["done", "skipped"].includes(step.status))?.id;
}

export function ProductionPlanChecklist({ plan }: { plan: AssistantProductionPlan }) {
  const activeId = activeStepId(plan);

  return (
    <section className="graph-assistant-production-plan" aria-label="Production plan">
      <header>
        <span>Production plan</span>
        <strong>{plan.goal}</strong>
      </header>
      {plan.constraints.length ? (
        <dl className="graph-assistant-production-constraints">
          {plan.constraints.map((constraint) => (
            <div key={constraint.name}>
              <dt>{label(constraint.name)}</dt>
              <dd>
                <strong>{String(constraint.value)}</strong>
                {constraint.model_key ? <small>{constraint.model_key}</small> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ol className="graph-assistant-production-steps" aria-label="Production steps">
        {plan.steps.map((step) => (
          <li
            key={step.id}
            aria-current={step.id === activeId ? "step" : undefined}
            data-active={step.id === activeId}
            data-status={step.status}
          >
            <span aria-hidden="true" />
            <div>
              <strong>{step.title}</strong>
              <small>{label(step.kind)} · {label(step.status)}</small>
              {step.notes ? <p>{step.notes}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
