import { useListPlans, useCreatePlan } from "@workspace/api-client-react";
import { Plus, Wifi, Zap, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Plans() {
  const { data: plans, isLoading } = useListPlans();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Service Plans</h1>
          <p className="text-gray-500 text-sm">Manage internet packages and pricing tiers.</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Create Plan
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <Skeleton className="h-8 w-1/2 mb-4" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-3/4 mb-6" />
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ))
        ) : plans && plans.length > 0 ? (
          plans.map((plan) => (
            <div key={plan.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow relative flex flex-col">
              {!plan.isActive && (
                <div className="absolute top-0 right-0 p-4">
                  <Badge variant="secondary" className="bg-gray-100 text-gray-600">Inactive</Badge>
                </div>
              )}
              <div className="p-6 border-b border-gray-100 flex-1">
                <h3 className="text-xl font-bold text-gray-900 mb-2 pr-16">{plan.name}</h3>
                <p className="text-sm text-gray-500 mb-6 h-10 line-clamp-2">{plan.description || "No description provided."}</p>
                
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-3xl font-bold text-gray-900">${plan.price.toFixed(2)}</span>
                  <span className="text-sm text-gray-500">/{plan.billingCycle}</span>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center text-sm font-medium text-gray-700 bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                    <Zap className="w-4 h-4 text-blue-600 mr-3" />
                    <span className="w-20 text-gray-500">Download</span>
                    <span className="text-blue-900 font-bold">{plan.downloadSpeed} Mbps</span>
                  </div>
                  <div className="flex items-center text-sm font-medium text-gray-700 bg-green-50/50 p-3 rounded-lg border border-green-100">
                    <Wifi className="w-4 h-4 text-green-600 mr-3" />
                    <span className="w-20 text-gray-500">Upload</span>
                    <span className="text-green-900 font-bold">{plan.uploadSpeed} Mbps</span>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-gray-50 flex gap-3">
                <Button variant="outline" className="flex-1 border-gray-300 bg-white">Edit</Button>
                <Button variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50 px-3">
                  Delete
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full py-12 text-center text-gray-500 bg-white rounded-lg border border-gray-200 border-dashed">
            No service plans found. Create one to get started.
          </div>
        )}
      </div>
    </div>
  );
}
