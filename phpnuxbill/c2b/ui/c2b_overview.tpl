{include file="sections/header.tpl"}
<style>
    body { background-color: #f8f9fa; font-family: 'Arial', sans-serif; }

    .container {
        margin-top: 20px;
        background-color: #d8dfe5;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0,0,0,.1);
        padding: 20px;
        max-width: 98%;
    }

    .table { width: 100%; margin-bottom: 1rem; background-color: #fff; box-shadow: 0 4px 6px rgba(0,0,0,.1); }
    .table th { vertical-align: middle; background-color: #343a40; color: #fff; border-color: #dee2e6; }
    .table td { vertical-align: middle; border-color: #dee2e6; }
    .table-striped tbody tr:nth-of-type(odd) { background-color: rgba(0,0,0,.05); }
    .table-hover tbody tr:hover { background-color: rgba(0,0,0,.075); font-weight: bold; transition: background-color .3s, color .3s; }

    .pagination .page-item .page-link { color: #007bff; background-color: #fff; border: 1px solid #dee2e6; margin: 0 2px; padding: 6px 12px; transition: background-color .3s, color .3s; }
    .pagination .page-item .page-link:hover { background-color: #e9ecef; color: #0056b3; }
    .pagination .page-item.active .page-link { color: #fff; background-color: #007bff; border-color: #007bff; }
</style>

{if isset($message)}
<div class="alert alert-{if $notify_t == 's'}success{else}danger{/if}">
    <button type="button" class="close" data-dismiss="alert"><span aria-hidden="true">×</span></button>
    <div>{$message}</div>
</div>
{/if}

<div class="col-md-14">
    <div class="box box-info">
        <div class="box-header with-border">
            <h3 class="box-title">{Lang::T('Payment History')}</h3>
            <div class="box-tools pull-right">
                <button type="button" class="btn bg-teal btn-sm" data-widget="collapse"><i class="fa fa-refresh"></i></button>
                <a href="{$app_url}/pages/mpesa-webhook.html" class="btn bg-teal btn-sm"><i class="fa fa-file"></i></a>
            </div>
        </div>
        <div class="box-body">
            <div class="container">
                <div class="table-responsive">
                    <table class="table table-bordered table-striped table-hover" id="payments-table">
                        <thead>
                            <tr>
                                <th>{Lang::T('Customer Name')}</th>
                                <th>{Lang::T('Transaction Type')}</th>
                                <th>{Lang::T('Transaction Time')}</th>
                                <th>{Lang::T('Amount Paid')}</th>
                                <th>{Lang::T('Package Name')}</th>
                                <th>{Lang::T('Package Price')}</th>
                                <th>{Lang::T('Status')}</th>
                                <th>{Lang::T('Bill Ref Number')}</th>
                                <th>{Lang::T('Company Balance')}</th>
                                <th>{Lang::T('Date')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {foreach $payments as $payment}
                            <tr>
                                <td>
                                    <a href="{$app_url}/index.php?_route=customers/view/{$payment.CustomerID}">
                                        {$payment.FirstName}
                                    </a>
                                </td>
                                <td>{$payment.TransactionType}</td>
                                <td>{$payment.TransTime}</td>
                                <td>KES {$payment.TransAmount|number_format:2}</td>
                                <td>{$payment.PackageName}</td>
                                <td>KES {$payment.PackagePrice|number_format:2}</td>
                                <td>
                                    {{* BUG FIX #7: Original compared without quotes — Smarty treated
                                        "Completed" as an undefined constant (like PHP bare strings) so
                                        the label classes were never applied. Added double-quotes. *}}
                                    <span class="label
                                        {if $payment.TransactionStatus == "Completed"}label-success
                                        {elseif $payment.TransactionStatus == "Pending"}label-warning
                                        {else}label-default{/if}">
                                        {$payment.TransactionStatus}
                                    </span>
                                </td>
                                <td>{$payment.BillRefNumber}</td>
                                <td>KES {$payment.OrgAccountBalance|number_format:2}</td>
                                <td>{$payment.CreatedAt}</td>
                            </tr>
                            {foreachelse}
                            <tr>
                                <td colspan="10" class="text-center text-muted">No M-Pesa transactions found.</td>
                            </tr>
                            {/foreach}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>

<link rel="stylesheet" href="https://cdn.datatables.net/1.11.5/css/jquery.dataTables.min.css">
<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
<script src="https://cdn.datatables.net/1.11.5/js/jquery.dataTables.min.js"></script>
<script>
    jQuery(function ($) {
        $('#payments-table').DataTable({ pagingType: 'full_numbers', order: [[2, 'desc']] });
    });
</script>

{include file="sections/footer.tpl"}
