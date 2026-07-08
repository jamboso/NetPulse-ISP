import { useState } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetTicket, 
  useGetTicketReplies, 
  useReplyToTicket,
  getGetTicketRepliesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, User, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/formatDate";
import { useSession } from "@/lib/authClient";

export default function TicketDetail() {
  const { id } = useParams();
  const ticketId = parseInt(id || "0", 10);
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const user = session?.user;
  const [replyMessage, setReplyMessage] = useState("");

  const { data: ticket, isLoading: loadingTicket } = useGetTicket(ticketId);
  const { data: replies, isLoading: loadingReplies } = useGetTicketReplies(ticketId);

  const replyMutation = useReplyToTicket({
    mutation: {
      onSuccess: () => {
        setReplyMessage("");
        queryClient.invalidateQueries({ queryKey: getGetTicketRepliesQueryKey(ticketId) });
      }
    }
  });

  const handleReplySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyMessage.trim()) return;
    replyMutation.mutate({
      id: ticketId,
      data: {
        message: replyMessage,
        author: user?.name || user?.email || "Staff Agent",
        isStaff: true,
      }
    });
  };

  if (loadingTicket) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">Ticket not found</h2>
        <p className="text-gray-500 mt-2">The ticket you're looking for doesn't exist.</p>
        <Button asChild className="mt-4"><Link href="/tickets">Back to Tickets</Link></Button>
      </div>
    );
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-700 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-gray-100 text-gray-700 border-gray-200';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-2">
        <Button variant="outline" size="icon" asChild className="h-8 w-8">
          <Link href="/tickets"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 truncate">{ticket.subject}</h1>
          <span className="text-sm font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded shrink-0">
            #{String(ticket.id).padStart(5, '0')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Original Message */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-start">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">
                  {ticket.customer?.name.charAt(0).toUpperCase() || 'C'}
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{ticket.customer?.name || `Customer #${ticket.customerId}`}</div>
                  <div className="text-xs text-gray-500">Customer</div>
                </div>
              </div>
              <div className="text-xs text-gray-500 flex items-center">
                <Clock className="w-3 h-3 mr-1" />
                {formatDate(ticket.createdAt, 'MMM d, yyyy h:mm a')}
              </div>
            </div>
            <div className="p-5 text-gray-800 whitespace-pre-wrap leading-relaxed">{ticket.description}</div>
          </div>

          {/* Replies */}
          <div className="space-y-4">
            {loadingReplies ? (
              <Skeleton className="h-32 w-full" />
            ) : replies && replies.length > 0 ? (
              replies.map(reply => (
                <div key={reply.id} className={`bg-white rounded-lg border shadow-sm overflow-hidden ${reply.isStaff ? 'border-blue-200 ml-8' : 'border-gray-200 mr-8'}`}>
                  <div className={`p-3 border-b flex justify-between items-start ${reply.isStaff ? 'bg-blue-50/50 border-blue-100' : 'bg-gray-50/50 border-gray-100'}`}>
                    <div className="flex gap-3 items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${reply.isStaff ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
                        {reply.isStaff ? 'S' : 'C'}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900 text-sm">{reply.author}</div>
                        <div className="text-xs text-gray-500">{reply.isStaff ? 'Staff Member' : 'Customer'}</div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">{formatDate(reply.createdAt, 'MMM d, h:mm a')}</div>
                  </div>
                  <div className="p-4 text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">{reply.message}</div>
                </div>
              ))
            ) : null}
          </div>

          {/* Reply Box */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">Send a Reply</h3>
            <form onSubmit={handleReplySubmit}>
              <Textarea value={replyMessage} onChange={e => setReplyMessage(e.target.value)}
                placeholder="Type your reply here..." className="min-h-[120px] mb-3 resize-y focus-visible:ring-blue-500 border-gray-300" />
              <div className="flex justify-end">
                <Button type="submit" disabled={!replyMessage.trim() || replyMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
                  {replyMutation.isPending ? "Sending…" : <><Send className="w-4 h-4 mr-2" />Send Reply</>}
                </Button>
              </div>
            </form>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-4 text-sm uppercase tracking-wider">Ticket Details</h3>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Status</p>
                <Badge variant="outline" className="capitalize bg-gray-100">{ticket.status.replace('_', ' ')}</Badge>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Priority</p>
                <Badge variant="outline" className={`capitalize ${getPriorityColor(ticket.priority)}`}>{ticket.priority}</Badge>
              </div>
              {ticket.category && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Category</p>
                  <p className="text-sm text-gray-900 capitalize">{ticket.category}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Assigned To</p>
                <div className="flex items-center text-sm text-gray-900">
                  <User className="w-3.5 h-3.5 mr-1.5 text-gray-400" />{ticket.assignedTo || "Unassigned"}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-4 text-sm uppercase tracking-wider">Customer Info</h3>
            {ticket.customer ? (
              <div className="space-y-3">
                <Link href={`/customers/${ticket.customerId}`} className="font-medium text-blue-600 hover:underline block truncate">{ticket.customer.name}</Link>
                <div className="text-sm text-gray-600 truncate">{ticket.customer.email}</div>
                <div className="text-sm text-gray-600">{ticket.customer.phone}</div>
                <div className="mt-4">
                  <Badge variant="outline" className={ticket.customer.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100'}>
                    {ticket.customer.status}
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">Customer ID: {ticket.customerId}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
