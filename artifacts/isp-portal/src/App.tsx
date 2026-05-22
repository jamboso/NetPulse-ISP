import { useEffect, useState, Component, type ReactNode } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import { queryClient } from "./lib/queryClient";
import { useSession, signOut } from "./lib/authClient";
import Layout from "./components/layout";

import Dashboard from "./pages/dashboard";
import Customers from "./pages/customers";
import CustomerDetail from "./pages/customer-detail";
import Plans from "./pages/plans";
import Subscriptions from "./pages/subscriptions";
import Invoices from "./pages/invoices";
import Payments from "./pages/payments";
import Tickets from "./pages/tickets";
import TicketDetail from "./pages/ticket-detail";
import Network from "./pages/network";
import RouterOSDashboard from "./pages/ros-dashboard";
import PPPoESetup from "./pages/pppoe-setup";
import HotspotManager from "./pages/hotspot-manager";
import CaptivePortal from "./pages/captive-portal";
import Settings from "./pages/settings";
import Compliance from "./pages/compliance";
import SmsManager from "./pages/sms-manager";
import Monitoring from "./pages/monitoring";
import NetworkMap from "./pages/network-map";
import SetupWizard from "./pages/setup-wizard";
import SignInPage from "./pages/sign-in";
import MpesaTransactions from "./pages/mpesa-transactions";
import Staff from "./pages/staff";
import Sales from "./pages/sales";
import AuditLogs from "./pages/audit-logs";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

class ErrorBoundary extends Component<{ children: ReactNode; routeKey?: string }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prevProps: { routeKey?: string }) {
    if (prevProps.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    const err = this.state.error as Error | null;
    if (err) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center p-8">
          <p className="text-lg font-semibold text-gray-800">Something went wrong on this page.</p>
          <p className="text-xs font-mono text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2 max-w-xl break-words">{err.message}</p>
          <p className="text-sm text-gray-500">Try navigating to another page, or click below to retry.</p>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            onClick={() => this.setState({ error: null })}
          >Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function SetupGuard({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (location === "/setup") { setChecked(true); return; }
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((d: { complete: boolean }) => {
        if (!d.complete) setLocation("/setup");
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!checked) return null;
  return <>{children}</>;
}

function AuthGuard({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    if (!isPending && !session) {
      qc.clear();
      setLocation("/sign-in");
    }
  }, [session, isPending, setLocation, qc]);

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return null;
  return <>{children}</>;
}

type SessionUser = { role?: string; [key: string]: unknown };

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: session, isPending } = useSession();
  const [, setLocation] = useLocation();
  const user = session?.user as SessionUser | undefined;

  useEffect(() => {
    if (!isPending && user && user.role !== "admin") {
      setLocation("/");
    }
  }, [user, isPending, setLocation]);

  if (isPending) return null;
  if (!user || user.role !== "admin") return null;
  return <Component />;
}

function ProtectedRoutes() {
  const [location] = useLocation();
  return (
    <ErrorBoundary routeKey={location}>
      <SetupGuard>
        <Layout>
          <Switch>
            <Route path="/setup" component={SetupWizard} />
            <Route path="/" component={Dashboard} />
            <Route path="/customers" component={Customers} />
            <Route path="/customers/:id" component={CustomerDetail} />
            <Route path="/plans" component={Plans} />
            <Route path="/subscriptions" component={Subscriptions} />
            <Route path="/invoices" component={Invoices} />
            <Route path="/payments" component={Payments} />
            <Route path="/mpesa" component={MpesaTransactions} />
            <Route path="/tickets" component={Tickets} />
            <Route path="/tickets/:id" component={TicketDetail} />
            <Route path="/network" component={Network} />
            <Route path="/network/routers/:id" component={RouterOSDashboard} />
            <Route path="/network/routers/:id/pppoe" component={PPPoESetup} />
            <Route path="/network/routers/:id/hotspot" component={HotspotManager} />
            <Route path="/settings" component={Settings} />
            <Route path="/staff">{() => <AdminRoute component={Staff} />}</Route>
            <Route path="/audit-logs">{() => <AdminRoute component={AuditLogs} />}</Route>
            <Route path="/sales" component={Sales} />
            <Route path="/compliance" component={Compliance} />
            <Route path="/sms" component={SmsManager} />
            <Route path="/monitoring" component={Monitoring} />
            <Route path="/map" component={NetworkMap} />
            <Route>
              <div className="p-8 text-center text-gray-500">Page not found.</div>
            </Route>
          </Switch>
        </Layout>
      </SetupGuard>
    </ErrorBoundary>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/setup" component={SetupWizard} />
      <Route path="/hotspot/:routerId" component={CaptivePortal} />
      <Route>
        <AuthGuard>
          <ProtectedRoutes />
        </AuthGuard>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AppRouter />
      </QueryClientProvider>
    </WouterRouter>
  );
}
