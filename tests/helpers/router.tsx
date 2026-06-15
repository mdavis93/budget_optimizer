import { ReactNode } from 'react';
import { MemoryRouter, MemoryRouterProps } from 'react-router-dom';
import { ROUTER_FUTURE_FLAGS } from '@/constants/routerFutureFlags';

export { ROUTER_FUTURE_FLAGS };

export function TestMemoryRouter({
  children,
  ...props
}: MemoryRouterProps & { children: ReactNode }) {
  return (
    <MemoryRouter future={ROUTER_FUTURE_FLAGS} {...props}>
      {children}
    </MemoryRouter>
  );
}
