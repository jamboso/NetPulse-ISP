import { useState } from "react";
import { useListEquipment, useListIpPools } from "@workspace/api-client-react";
import { Plus, Server, Route, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

export default function Network() {
  const { data: equipmentData, isLoading: loadingEquipment } = useListEquipment();
  const { data: ipPoolsData, isLoading: loadingIpPools } = useListIpPools();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'offline': return 'bg-red-500';
      case 'maintenance': return 'bg-orange-500';
      default: return 'bg-gray-400';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Network Infrastructure</h1>
          <p className="text-gray-500 text-sm">Manage hardware and IP resources.</p>
        </div>
      </div>

      <Tabs defaultValue="equipment" className="w-full">
        <TabsList className="grid w-[400px] grid-cols-2 bg-gray-100">
          <TabsTrigger value="equipment" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Server className="w-4 h-4 mr-2" />
            Equipment
          </TabsTrigger>
          <TabsTrigger value="ippools" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Route className="w-4 h-4 mr-2" />
            IP Pools
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="equipment" className="mt-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" size="sm">
                <Plus className="w-4 h-4 mr-2" /> Add Equipment
              </Button>
            </div>
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingEquipment ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-4 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : equipmentData && equipmentData.length > 0 ? (
                  equipmentData.map((item) => (
                    <TableRow key={item.id} className="hover:bg-gray-50/50">
                      <TableCell>
                        <div className="flex items-center justify-center w-8">
                          <div className={`w-3 h-3 rounded-full ${getStatusColor(item.status)} shadow-sm`} title={item.status} />
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-gray-900">{item.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize bg-gray-100 text-gray-700 border-0">
                          {item.type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-gray-600">{item.ipAddress}</TableCell>
                      <TableCell className="text-gray-500 text-sm">{item.location || '—'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-gray-500">
                      No equipment found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        
        <TabsContent value="ippools" className="mt-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" size="sm">
                <Plus className="w-4 h-4 mr-2" /> Add IP Pool
              </Button>
            </div>
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead>Pool Name / CIDR</TableHead>
                  <TableHead className="w-1/3">Usage</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>DNS Servers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingIpPools ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-10 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : ipPoolsData && ipPoolsData.length > 0 ? (
                  ipPoolsData.map((pool) => {
                    const usagePercent = Math.round((pool.usedIps / pool.totalIps) * 100);
                    return (
                      <TableRow key={pool.id} className="hover:bg-gray-50/50">
                        <TableCell>
                          <div className="font-medium text-gray-900">{pool.name}</div>
                          <div className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded inline-block mt-1">
                            {pool.network}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1.5 w-full pr-8">
                            <div className="flex justify-between text-xs text-gray-500">
                              <span>{pool.usedIps} used</span>
                              <span>{pool.totalIps - pool.usedIps} available</span>
                            </div>
                            <Progress value={usagePercent} className="h-2 bg-gray-100" />
                            <div className="text-right text-xs font-medium text-gray-700">{usagePercent}%</div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-gray-600">{pool.gateway}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 font-mono text-sm text-gray-600">
                            <span>{pool.dns1 || '—'}</span>
                            {pool.dns2 && <span>{pool.dns2}</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-gray-500">
                      No IP pools found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
