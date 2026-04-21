import { SurfaceCard, SectionHeader } from "@/components/ui/surface-primitives";

export function Panel({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <SurfaceCard as="section" id={id} appearance="admin" className={className}>
      {children}
    </SurfaceCard>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return <SectionHeader appearance="admin" eyebrow={eyebrow} title={title} description={description} action={action} />;
}
