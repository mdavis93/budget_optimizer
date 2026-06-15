import { ReactNode } from 'react';
import { MemoryRouter, MemoryRouterProps } from 'react-router-dom';

export function TestMemoryRouter({
  children,
  ...props
}: MemoryRouterProps & { children: ReactNode }) {
  return <MemoryRouter {...props}>{children}</MemoryRouter>;
}
