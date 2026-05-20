import { useState } from "react";
import { Link } from "wouter";
import { useListPayments } from "@workspace/api-client-react";
import { Plus, Filter, CreditCard, ArrowDownToLine, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function Payments() {
  const { data: paymentsData, isLoading } = useListPayments({ limit: 50 });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700 border-green-200';
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'failed': return 'bg-red-100 text-red-700 border-red-200';
      case 'refunded': return 'bg-gray-100 text-gray-700 border-gray-200';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'card': return <CreditCard className="w-4 h-4 text-gray-500" />;
      case 'bank_transfer': return <ArrowDownToLine className="w-4 h-4 text-gray-500" />;
      case 'cash': return <Receipt className="w-4 h-4 text-gray-500" />;
      default: return <CreditCard className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatMethod = (method: string) => {
    return method.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Payments</h1>
          <p className="text-gray-500 text-sm">Track incoming revenue and transaction history.</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Record Payment
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <div className="flex items-center text-sm font-medium text-gray-700">
            Recent Transactions
          </div>
          <Button variant="outline" size="sm" className="bg-white">
            <Filter className="w-4 h-4 mr-2" /> Filter
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Transaction Ref</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : paymentsData?.data && paymentsData.data.length > 0 ? (
                paymentsData.data.map((payment) => (
                  <TableRow key={payment.id} className="hover:bg-gray-50/50">
                    <TableCell className="font-mono text-sm text-gray-500">
                      {payment.reference || `TXN-${String(payment.id).padStart(6, '0')}`}
                    </TableCell>
                    <TableCell className="font-medium text-gray-900">
                      {payment.customer ? (
                        <Link href={`/customers/${payment.customerId}`} className="hover:text-blue-600 hover:underline">
                          {payment.customer.name}
                        </Link>
                      ) : `Customer #${payment.customerId}`}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-blue-600 hover:underline cursor-pointer">
                      INV-{String(payment.invoiceId).padStart(5, '0')}
                    </TableCell>
                    <TableCell className="font-bold text-gray-900">
                      ${payment.amount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-gray-700 text-sm">
                        {getMethodIcon(payment.method)}
                        {formatMethod(payment.method)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${getStatusColor(payment.status)}`}>
                        {payment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {format(new Date(payment.createdAt), 'MMM d, yyyy h:mm a')}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-gray-500">
                    No payments found.
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
