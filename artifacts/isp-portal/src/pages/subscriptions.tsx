import { useState } from "react";
import { Link } from "wouter";
import { useListSubscriptions } from "@workspace/api-client-react";
import { Plus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function Subscriptions() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data: subscriptionsData, isLoading } = useListSubscriptions(
    statusFilter ? { status: statusFilter } : {}
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700 border-green-200';
      case 'suspended': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'cancelled': return 'bg-red-100 text-red-700 border-red-200';
      case 'expired': return 'bg-gray-100 text-gray-700 border-gray-200';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Subscriptions</h1>
          <p className="text-gray-500 text-sm">Manage active services and connections.</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="w-4 h-4 mr-2" />
          New Subscription
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex gap-2">
          <div className="flex items-center text-sm text-gray-500 mr-2">
            <Filter className="w-4 h-4 mr-2" /> Filter:
          </div>
          {['all', 'active', 'suspended', 'cancelled', 'expired'].map((status) => (
            <Button 
              key={status}
              variant={statusFilter === status || (status === 'all' && !statusFilter) ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status === 'all' ? undefined : status)}
              className={statusFilter === status || (status === 'all' && !statusFilter) ? 'bg-blue-600' : 'bg-white'}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>IP / MAC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : subscriptionsData?.data && subscriptionsData.data.length > 0 ? (
                subscriptionsData.data.map((sub) => (
                  <TableRow key={sub.id} className="hover:bg-gray-50/50">
                    <TableCell className="font-medium text-gray-900">
                      {sub.customer ? (
                        <Link href={`/customers/${sub.customerId}`} className="hover:text-blue-600 hover:underline">
                          {sub.customer.name}
                        </Link>
                      ) : `Customer #${sub.customerId}`}
                    </TableCell>
                    <TableCell>
                      {sub.plan ? sub.plan.name : `Plan #${sub.planId}`}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-mono text-gray-600">{sub.ipAddress || '—'}</div>
                      <div className="text-xs font-mono text-gray-400">{sub.macAddress || '—'}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${getStatusColor(sub.status)}`}>
                        {sub.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {format(new Date(sub.startDate), 'MMM d, yyyy')}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-gray-500">
                    No subscriptions found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
