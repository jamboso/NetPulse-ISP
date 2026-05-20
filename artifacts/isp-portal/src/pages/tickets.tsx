import { useState } from "react";
import { Link } from "wouter";
import { useListTickets } from "@workspace/api-client-react";
import { Plus, Filter, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function Tickets() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data: ticketsData, isLoading } = useListTickets(
    statusFilter ? { status: statusFilter } : {}
  );

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-700 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-gray-100 text-gray-700 border-gray-200';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'in_progress': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'resolved': return 'bg-green-100 text-green-700 border-green-200';
      case 'closed': return 'bg-gray-100 text-gray-700 border-gray-200';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Support Tickets</h1>
          <p className="text-gray-500 text-sm">Manage customer support requests and issues.</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Create Ticket
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex flex-wrap gap-2">
          <div className="flex items-center text-sm text-gray-500 mr-2">
            <Filter className="w-4 h-4 mr-2" /> Filter:
          </div>
          {['all', 'open', 'in_progress', 'resolved', 'closed'].map((status) => (
            <Button 
              key={status}
              variant={statusFilter === status || (status === 'all' && !statusFilter) ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status === 'all' ? undefined : status)}
              className={statusFilter === status || (status === 'all' && !statusFilter) ? 'bg-blue-600' : 'bg-white'}
            >
              {status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-[100px]">ID</TableHead>
                <TableHead className="w-[300px]">Subject</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : ticketsData?.data && ticketsData.data.length > 0 ? (
                ticketsData.data.map((ticket) => (
                  <TableRow key={ticket.id} className="hover:bg-gray-50/50 cursor-pointer">
                    <TableCell className="font-mono text-sm text-gray-500">
                      <Link href={`/tickets/${ticket.id}`}>
                        #{String(ticket.id).padStart(5, '0')}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium text-gray-900">
                      <Link href={`/tickets/${ticket.id}`} className="hover:text-blue-600 block w-full truncate">
                        {ticket.subject}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {ticket.customer ? (
                        <Link href={`/customers/${ticket.customerId}`} className="text-gray-600 hover:text-blue-600 hover:underline">
                          {ticket.customer.name}
                        </Link>
                      ) : `Customer #${ticket.customerId}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${getPriorityColor(ticket.priority)}`}>
                        {ticket.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${getStatusColor(ticket.status)}`}>
                        {ticket.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {format(new Date(ticket.createdAt), 'MMM d, yyyy')}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-gray-500">
                    No tickets found.
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
