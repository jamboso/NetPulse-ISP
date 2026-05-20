{include file="sections/header.tpl"}
<script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
<style>
    .styled-form-group { margin-bottom: 20px; }
    .styled-btn { color: #28a745; border: 1px solid #28a745; background-color: #fff; padding: 10px 20px; font-size: 16px; text-align: center; display: inline-block; transition: all .3s ease; }
    .styled-btn:hover { background-color: #28a745; color: #fff; }
    .styled-small-text { color: blue; margin-top: 10px; display: block; font-size: 14px; }
    .switch { position: relative; display: inline-block; width: 50px; height: 24px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 24px; }
    .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
    input:checked + .slider { background-color: #2196F3; }
    input:focus  + .slider { box-shadow: 0 0 1px #2196F3; }
    input:checked + .slider:before { transform: translateX(26px); }
</style>

{if isset($message)}
<div class="alert alert-{if $notify_t == 's'}success{else}danger{/if}">
    <button type="button" class="close" data-dismiss="alert"><span aria-hidden="true">×</span></button>
    <div>{$message}</div>
</div>
{/if}

<form class="form-horizontal" method="post" role="form" action="{$_url}plugin/c2b_settings">
    <div class="row">
        <div class="col-sm-12 col-md-12">
            <div class="panel panel-primary panel-hovered panel-stacked mb30">
                <div class="panel-heading">{Lang::T('M-Pesa C2B Payment Gateway')}</div>
                <div class="panel-body">

                    <div class="form-group col-6">
                        <label class="col-md-3 control-label">{Lang::T('Environment')}</label>
                        <div class="col-md-6">
                            <select class="form-control" name="mpesa_c2b_env">
                                <option value="sandbox" {if $_c['mpesa_c2b_env']=='sandbox'}selected{/if}>Sandbox / Testing</option>
                                <option value="live"    {if $_c['mpesa_c2b_env']=='live'   }selected{/if}>Live / Production</option>
                            </select>
                            <small class="form-text text-muted">
                                <font color="red"><b>Sandbox</b></font> is for testing only. Switch to
                                <font color="green"><b>Live</b></font> in production.
                            </small>
                        </div>
                    </div>

                    <div class="form-group col-6">
                        <label class="col-md-3 control-label">Consumer Key</label>
                        <div class="col-md-6">
                            <input type="text" class="form-control" name="mpesa_c2b_consumer_key"
                                   placeholder="xxxxxxxxxxxxxxxxx" value="{$_c['mpesa_c2b_consumer_key']}">
                            <small class="form-text text-muted">
                                <a href="https://developer.safaricom.co.ke/MyApps" target="_blank">Get from Daraja portal →</a>
                            </small>
                        </div>
                    </div>

                    <div class="form-group col-6">
                        <label class="col-md-3 control-label">Consumer Secret</label>
                        <div class="col-md-6">
                            <input type="password" class="form-control" name="mpesa_c2b_consumer_secret"
                                   placeholder="xxxxxxxxxxxxxxxxx" value="{$_c['mpesa_c2b_consumer_secret']}">
                        </div>
                    </div>

                    <div class="form-group col-6">
                        <label class="col-md-3 control-label">Business Shortcode (PayBill)</label>
                        <div class="col-md-6">
                            <input type="text" class="form-control" name="mpesa_c2b_business_code"
                                   placeholder="xxxxxxx" maxlength="7" value="{$_c['mpesa_c2b_business_code']}">
                        </div>
                    </div>

                    <div class="form-group col-6">
                        <label class="col-md-3 control-label">API Version</label>
                        <div class="col-md-6">
                            <select class="form-control" name="mpesa_c2b_api">
                                <option value="v1" {if $_c['mpesa_c2b_api']=='v1'}selected{/if}>v1 (standard)</option>
                                <option value="v2" {if $_c['mpesa_c2b_api']=='v2'}selected{/if}>v2 (enhanced)</option>
                            </select>
                            <small class="form-text text-muted">Use v1 unless Safaricom specifically requires v2.</small>
                        </div>
                    </div>

                    <div class="form-group col-6">
                        <label class="col-md-3 control-label">Bill Ref Number Type</label>
                        <div class="col-md-6">
                            <select class="form-control" name="mpesa_c2b_bill_ref">
                                <option value="phone"    {if $_c['mpesa_c2b_bill_ref']=='phone'   }selected{/if}>Phone Number</option>
                                <option value="username" {if $_c['mpesa_c2b_bill_ref']=='username'}selected{/if}>Username</option>
                                <option value="id"       {if $_c['mpesa_c2b_bill_ref']=='id'      }selected{/if}>Account ID</option>
                            </select>
                            <small class="form-text text-muted">
                                How customers identify themselves when paying — the value they enter as account number on M-Pesa.
                            </small>
                        </div>
                    </div>

                    <div class="form-group col-6">
                        <label class="col-md-3 control-label">{Lang::T('Accept Partial Payment')}</label>
                        <div class="col-md-6">
                            <label class="switch">
                                <input type="checkbox" name="mpesa_c2b_low_fee" value="1"
                                       {if $_c['mpesa_c2b_low_fee']==1}checked{/if}>
                                <span class="slider"></span>
                            </label>
                            <small class="form-text text-muted d-block mt-1">
                                When ON, partial payments are saved to customer balance instead of being rejected.
                                Requires a Validation URL to be registered.
                            </small>
                        </div>
                    </div>

                    <div class="form-group col-12 styled-form-group">
                        <label class="col-md-3 control-label">Register C2B URLs</label>
                        <div class="col-md-6">
                            {if $_c['c2b_registered'] && $_c['mpesa_c2b_env'] != 'sandbox'}
                                <button class="btn styled-btn" disabled>✔ URLs Already Registered</button>
                            {else}
                                <a href="{$_url}plugin/c2b_registerUrl" class="btn styled-btn">Click to Register M-Pesa C2B URLs</a>
                                <small class="form-text text-muted styled-small-text">
                                    Save your settings first, then click this button once.
                                </small>
                            {/if}
                        </div>
                    </div>

                    <div class="form-group col-6">
                        <div class="col-lg-offset-3 col-lg-10">
                            <button class="btn btn-primary waves-effect waves-light" name="save" value="save" type="submit">
                                Save Changes
                            </button>
                        </div>
                    </div>

                    <div class="bs-callout bs-callout-info">
                        <h4><b>Callback URLs (for reference)</b></h4>
                        <p>
                            Confirmation: <code>{$_url}plugin/c2b_confirmation</code><br>
                            Validation: <code>{$_url}plugin/c2b_validation</code>
                        </p>
                        <h4><b>Accept Partial Payment</b></h4>
                        <p>When enabled, payments below the plan price are stored as customer balance credit.
                           The Validation URL must be registered for this to work.</p>
                        <h4><b>Sandbox Testing</b></h4>
                        <p>Shortcode: <code>174379</code> — no real money is moved in sandbox mode.</p>
                    </div>

                </div><!-- /.panel-body -->
            </div>
        </div>
    </div>
</form>

{include file="sections/footer.tpl"}
