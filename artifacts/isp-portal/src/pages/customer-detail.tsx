import { useParams, Link } from "wouter";
import { 
  useGetCustomer, 
  useListSubscriptions, 
  useListInvoices, 
  useListTickets 
} from "@workspace/api-client-react";
import { 
  User, Mail, Phone, MapPin, Calendar, CreditCard, Receipt, LifeBuoy, ArrowLeft, Edit
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

export default function CustomerDetail() {
  const { id } = useParams();
  const customerId = parseInt(id || "0", 10);

  const { data: customer, isLoading: loadingCustomer } = useGetCustomer(customerId);
  const { data: subscriptionsData, isLoading: loadingSubs } = useListSubscriptions({ customerId });
  const { data: invoicesData, isLoading: loadingInvoices } = useListInvoices({ customerId, limit: 10 });
  const { data: ticketsData, isLoading: loadingTickets } = useListTickets({ customerId });

  const subs = Array.isArray(subscriptionsData) ? subscriptionsData : [];
  const tickets = Array.isArray(ticketsData) ? ticketsData : [];
  const invoices = (invoicesData as any)?.data ?? invoicesData ?? [];

  if (loadingCustomer) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-[400px] rounded-xl" />
          <div className="lg:col-span-2"><Skeleton className="h-[400px] rounded-xl" /></div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">Customer not found</h2>
        <p className="text-gray-500 mt-2">The customer you're looking for doesn't exist or has been deleted.</p>
        <Button asChild className="mt-4"><Link href="/customers">Back to Customers</Link></Button>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700 border-green-200';
      case 'suspended': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'terminated': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild className="h-8 w-8">
          <Link href="/customers"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{customer.name}</h1>
            <Badge variant="outline" className={`capitalize ${getStatusColor(customer.status)}`}>{customer.status}</Badge>
          </div>
          <p className="text-gray-500 text-sm">Customer ID: #{customer.id}</p>
        </div>
        <Button variant="outline" className="bg-white">
          <Edit className="w-4 h-4 mr-2" /> Edit Profile
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
              <User className="w-4 h-4 mr-2 text-gray-500" /> Contact Information
            </h3>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Mail className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Email Address</p>
                  <a href={`mailto:${customer.email}`} className="text-sm text-blue-600 hover:underline">{customer.email}</a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Phone Number</p>
                  <a href={`tel:${customer.phone}`} className="text-sm text-blue-600 hover:underline">{customer.phone}</a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Billing Address</p>
                  <p className="text-sm text-gray-600">{customer.address}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Customer Since</p>
                  <p className="text-sm text-gray-600">{format(new Date(customer.createdAt), 'MMMM d, yyyy')}</p>
                </div>
              </div>
            </div>
          </div>
          {customer.notes && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-2 text-sm">Staff Notes</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <Tabs defaultValue="subscriptions" className="w-full">
            <TabsList className="bg-gray-100 p-1 w-full justify-start rounded-lg mb-6">
              <TabsTrigger value="subscriptions" className="data-[state=active]:bg-white rounded-md">
                <CreditCard className="w-4 h-4 mr-2" /> Subscriptions ({subs.length})
              </TabsTrigger>
              <TabsTrigger value="invoices" className="data-[state=active]:bg-white rounded-md">
                <Receipt className="w-4 h-4 mr-2" /> Invoices ({Array.isArray(invoices) ? invoices.length : 0})
              </TabsTrigger>
              <TabsTrigger value="tickets" className="data-[state=active]:bg-white rounded-md">
                <LifeBuoy className="w-4 h-4 mr-2" /> Tickets ({tickets.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="subscriptions" className="m-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Start Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingSubs ? (
                      <TableRow><TableCell colSpan={4}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                    ) : subs.length > 0 ? (
                      subs.map((sub: any) => (
                        <TableRow key={sub.id}>
                          <TableCell className="font-medium text-gray-900">{sub.plan?.name || `Plan #${sub.planId}`}</TableCell>
                          <TableCell className="font-mono text-sm text-gray-600">{sub.ipAddress || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`capitalize ${sub.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}>
                              {sub.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">{format(new Date(sub.startDate), 'MMM d, yyyy')}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={4} className="h-24 text-center text-gray-500">No subscriptions found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="invoices" className="m-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Invoice ID</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingInvoices ? (
                      <TableRow><TableCell colSpan={4}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                    ) : Array.isArray(invoices) && invoices.length > 0 ? (
                      invoices.map((invoice: any) => (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-mono text-sm text-gray-600">INV-{String(invoice.id).padStart(5, '0')}</TableCell>
                          <TableCell className="font-medium text-gray-900">${(invoice.total ?? invoice.amount).toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`capitalize ${invoice.status === 'paid' ? 'bg-green-100 text-green-700' : invoice.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100'}`}>
                              {invoice.status}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-sm ${invoice.status === 'overdue' ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                            {format(new Date(invoice.dueDate), 'MMM d, yyyy')}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={4} className="h-24 text-center text-gray-500">No invoices found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="tickets" className="m-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingTickets ? (
                      <TableRow><TableCell colSpan={4}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                    ) : tickets.length > 0 ? (
                      tickets.map((ticket: any) => (
                        <TableRow key={ticket.id} className="cursor-pointer hover:bg-gray-50">
                          <TableCell className="font-mono text-sm text-gray-500">
                            <Link href={`/tickets/${ticket.id}`}>#{ticket.id}</Link>
                          </TableCell>
                          <TableCell className="font-medium text-gray-900">
                            <Link href={`/tickets/${ticket.id}`} className="hover:text-blue-600">{ticket.subject}</Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-gray-100 capitalize">{ticket.status.replace('_', ' ')}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">{format(new Date(ticket.createdAt), 'MMM d, yyyy')}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={4} className="h-24 text-center text-gray-500">No support tickets found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
