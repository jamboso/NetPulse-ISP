:local RosVer [:tonum [:pick [/system resource get version] 0 1]] 
:local getrouterinfo [/tool fetch url=("https://clarity.tabanawireless.com/v2/cdn/router/installation/".[/interface ethernet get 0 mac-address]."/MikroTik/get_version/1735376379/f3dccde50c01ca44c69235466985abdb10cbeea3/56a72c47565b3aabd0debe22772fea8d/22716/get_health/$RosVer") keep-result=no mode=https];
put "preparing config";
:delay 10
#:if ($getrouterinfo->"status" = "finished") do={
:local result [/tool fetch url=("https://clarity.tabanawireless.com/v2/cdn/ros/setup/1735376379/f3dccde50c01ca44c69235466985abdb10cbeea3/22716/2/56a72c47565b3aabd0debe22772fea8d/detailed_setup_1735376379_22716.rsc") keep-result=yes mode=https];
:if ($result->"status" = "finished") do={
:put "setup saved as detailed_setup_1735376379_22716.rsc";
};
/import file=detailed_setup_1735376379_22716.rsc;
#};

