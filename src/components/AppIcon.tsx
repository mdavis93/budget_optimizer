import clsx from 'clsx';

type AppIconProps = {
  className?: string;
};

export default function AppIcon({ className }: AppIconProps) {
  return (
    <img
      src="/icon_budget.svg"
      alt=""
      aria-hidden="true"
      className={clsx('object-contain', className)}
    />
  );
}
