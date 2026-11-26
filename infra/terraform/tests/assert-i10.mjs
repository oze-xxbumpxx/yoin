import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const work = process.argv[2];
const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const account = "111122223333";
const region = "ap-southeast-1";
const methods = ["DELETE", "GET", "PATCH", "POST", "PUT"];

for (const env of ["integration", "production"]) {
  const root = read(`../environments/${env}/main.tf`);
  const backend = root.match(/backend "s3" \{([^}]+)\}/)?.[1] ?? "";
  assert.match(backend, new RegExp(`\\bkey\\s*= "${env}/terraform\\.tfstate"`));
  assert.match(backend, new RegExp(`workspace_key_prefix\\s*= "workspaces/${env}"`));
  assert.match(backend, /region\s*= "ap-southeast-1"/);
  assert.match(backend, /encrypt\s*= true/);
  assert.match(backend, /use_lockfile\s*= true/);
  assert.match(root, /allowed_account_ids\s*= \[var\.aws_account_id\]/);

  const results = readFileSync(join(work, `${env}.jsonl`), "utf8").trim().split("\n").map(JSON.parse);
  const plan = results.find((record) => record.type === "test_plan" && record["@testrun"] === "environment_plan")?.test_plan;
  assert.ok(plan, `Missing ${env} root plan`);
  const entries = plan.resource_changes;
  const resources = new Map(entries.map(({ address, change }) => [address, change.after]));
  const module = "module.environment.";
  const entry = (addr) => {
    const value = resources.get(addr);
    assert.ok(value, `${env}: missing ${addr}`);
    return value;
  };
  const resource = (addr) => entry(module + addr);
  const shared = entries.filter(({ address }) => !address.startsWith(module)).map(({ address }) => address).sort();
  assert.deepEqual(shared, env === "integration" ? [
    "aws_budgets_budget.shared",
    'aws_cloudwatch_metric_alarm.shared["lambda"]',
    'aws_cloudwatch_metric_alarm.shared["ses"]',
    "aws_sesv2_account_suppression_attributes.shared",
  ] : []);

  const name = `yoin-${env}`;
  const arn = (service, suffix) => `arn:aws:${service}:${region}:${account}:${suffix}`;
  const queue = resource("aws_sqs_queue.failures");
  assert.equal(queue.name, `${name}-notification-failures`);
  assert.equal(queue.message_retention_seconds, 4 * 86400);
  assert.equal(queue.sqs_managed_sse_enabled, true);
  const queueArn = arn("sqs", queue.name);
  const schedulerRole = `arn:aws:iam::${account}:role/${name}-scheduler`;
  const sender = arn("lambda", `function:${name}-notification-sender`);
  assert.equal(resource("aws_scheduler_schedule_group.reminders").name, name);

  const policies = JSON.parse(resource("aws_iam_role.scheduler").assume_role_policy).Statement;
  assert.deepEqual(policies[0].Condition.StringEquals, {
    "aws:SourceAccount": account,
    "aws:SourceArn": arn("scheduler", `schedule-group/${name}`),
  });
  assert.deepEqual(JSON.parse(resource("aws_iam_role_policy.scheduler").policy).Statement.map((s) => [s.Action, s.Resource]), [
    ["lambda:InvokeFunction", sender], ["sqs:SendMessage", queueArn],
  ]);

  const release = resource("terraform_data.release").input;
  for (const [fn, timeout, params] of [
    ["api", 20, ["runtime/database-url", "runtime/invite-hmac-key"]],
    ["pre-sign-up", 4, ["pre-sign-up/database-url"]],
    ["notification-sender", 60, ["runtime/database-url", "runtime/vapid-private-key"]],
  ]) {
    const lambda = resource(`aws_lambda_function.function["${fn}"]`);
    assert.equal(lambda.function_name, `${name}-${fn}`);
    assert.equal(lambda.runtime, "nodejs24.x");
    assert.equal(lambda.timeout, timeout);
    assert.equal(lambda.tags.ReleaseSha, release);
    assert.equal(lambda.tags.DeployedAt, "2026-11-26T00:00:00Z");
    assert.ok(lambda.filename.endsWith(`/lambda/${fn}.zip`));
    assert.equal(resource(`aws_cloudwatch_log_group.function["${fn}"]`).retention_in_days, 7);
    const variables = lambda.environment[0].variables;
    assert.deepEqual(Object.entries(variables).filter(([key]) => key.endsWith("_PARAMETER")).map(([, value]) => value).sort(),
      params.map((param) => `/yoin/${env}/${param}`));
    const statements = JSON.parse(resource(`aws_iam_role_policy.function["${fn}"]`).policy).Statement;
    const bySid = Object.fromEntries(statements.map((s) => [s.Sid, s]));
    assert.deepEqual(bySid.ReadOwnParameters.Action, ["ssm:GetParameter"]);
    assert.deepEqual(bySid.ReadOwnParameters.Resource.sort(), params.map((param) => arn("ssm", `parameter/yoin/${env}/${param}`)));
    if (fn === "pre-sign-up") {
      assert.deepEqual(Object.keys(bySid).sort(), ["ReadOwnParameters", "WriteOwnLogs"]);
      assert.deepEqual(Object.keys(variables).sort(), ["DATABASE_URL_PARAMETER", "YOIN_ENVIRONMENT"]);
    } else {
      assert.deepEqual(bySid.ManageReminderSchedules.Resource, [arn("scheduler", `schedule/${name}/reminder-*`)]);
      assert.deepEqual(bySid.PassOnlyOwnSchedulerRole.Resource, [schedulerRole]);
      assert.deepEqual(bySid.PassOnlyOwnSchedulerRole.Condition, { StringEquals: { "iam:PassedToService": "scheduler.amazonaws.com" } });
      assert.equal(variables.SCHEDULER_TARGET_ARN, sender);
      assert.equal(variables.NOTIFICATION_FAILURE_QUEUE_ARN, queueArn);
      assert.equal(variables.PWA_ORIGIN ?? null, fn === "api" ? `https://${env}.cloudfront.net` : null);
      assert.deepEqual(bySid.SendFailure?.Resource ?? [], fn === "notification-sender" ? [queueArn] : []);
    }
  }
  const asyncFailure = resource("aws_lambda_function_event_invoke_config.notification_sender");
  assert.equal(asyncFailure.maximum_event_age_in_seconds, 3600);
  assert.equal(asyncFailure.maximum_retry_attempts, 2);
  assert.equal(asyncFailure.destination_config[0].on_failure[0].destination, queueArn);

  const pool = resource("aws_cognito_user_pool.users");
  assert.equal(pool.name, name);
  assert.equal(pool.user_pool_tier, "ESSENTIALS");
  assert.equal(pool.mfa_configuration, "OFF");
  assert.deepEqual(pool.auto_verified_attributes, ["email"]);
  assert.deepEqual(pool.sign_in_policy[0].allowed_first_auth_factors, ["EMAIL_OTP"]);
  assert.equal(pool.email_configuration[0].email_sending_account, "DEVELOPER");
  assert.equal(pool.email_configuration[0].source_arn, arn("ses", "identity/sender@example.invalid"));
  assert.equal(pool.lambda_config[0].pre_sign_up, arn("lambda", `function:${name}-pre-sign-up`));
  assert.equal(resource("aws_lambda_permission.cognito").source_arn, pool.arn);
  const client = resource("aws_cognito_user_pool_client.pwa");
  assert.equal(client.user_pool_id, pool.id);
  assert.equal(client.generate_secret, false);
  assert.equal(client.prevent_user_existence_errors, "ENABLED");
  assert.equal(client.enable_token_revocation, true);
  assert.equal(client.refresh_token_validity, 365);
  assert.equal(client.token_validity_units[0].refresh_token, "days");
  assert.deepEqual(client.explicit_auth_flows, ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_AUTH"]);

  const http = resource("aws_apigatewayv2_api.http");
  const cors = http.cors_configuration[0];
  assert.deepEqual(cors.allow_origins, [`https://${env}.cloudfront.net`]);
  assert.deepEqual(cors.allow_methods, methods);
  const jwt = resource("aws_apigatewayv2_authorizer.cognito");
  assert.deepEqual(jwt.jwt_configuration, [{ audience: [client.id], issuer: `https://${pool.endpoint}` }]);
  const routes = entries.filter(({ type }) => type === "aws_apigatewayv2_route").map(({ change }) => change.after);
  assert.deepEqual(routes.map((route) => route.route_key).sort(), methods.map((method) => `${method} /{proxy+}`));
  assert.ok(routes.every((route) => route.authorization_type === "JWT" && route.authorizer_id === jwt.id));
  const stage = resource("aws_apigatewayv2_stage.api");
  assert.equal(stage.default_route_settings[0].throttling_rate_limit, 20);
  assert.equal(stage.default_route_settings[0].throttling_burst_limit, 40);
  assert.deepEqual(Object.keys(JSON.parse(stage.access_log_settings[0].format)).sort(), ["latencyMs", "method", "requestId", "status"]);
  assert.equal(resource("aws_cloudwatch_log_group.gateway").retention_in_days, 7);

  const cloudfront = resource("aws_cloudfront_distribution.pwa");
  assert.equal(cloudfront.default_cache_behavior[0].cache_policy_id, "4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  assert.deepEqual(cloudfront.ordered_cache_behavior.map(({ path_pattern }) => path_pattern), ["/assets/*"]);
  assert.equal(resource("aws_cloudfront_origin_access_control.pwa").signing_behavior, "always");
  assert.equal(resource("aws_s3_bucket_public_access_block.pwa").block_public_policy, true);

  const alarm = (value, metric, threshold, period) =>
    assert.deepEqual([value.metric_name, value.threshold, value.period, value.treat_missing_data], [metric, threshold, period, "notBreaching"]);
  const failures = resource("aws_cloudwatch_metric_alarm.failures");
  assert.deepEqual(failures.dimensions, { QueueName: queue.name });
  alarm(failures, "ApproximateNumberOfMessagesVisible", 0, 60);
  const count = resource("aws_cloudwatch_metric_alarm.api_count");
  assert.deepEqual(count.dimensions, { ApiId: http.id });
  alarm(count, "Count", 125, 3600);

  if (env === "integration") {
    assert.deepEqual(entry("aws_sesv2_account_suppression_attributes.shared").suppressed_reasons.sort(), ["BOUNCE", "COMPLAINT"]);
    const budget = entry("aws_budgets_budget.shared");
    assert.deepEqual([budget.time_unit, budget.limit_unit, budget.limit_amount, budget.cost_types[0].include_credit], ["MONTHLY", "USD", "5", false]);
    assert.deepEqual(budget.notification.map(({ notification_type }) => notification_type).sort(), ["ACTUAL", "FORECASTED"]);
    for (const [key, metric, threshold] of [["lambda", "Invocations", 150], ["ses", "Send", 20]]) {
      const value = entry(`aws_cloudwatch_metric_alarm.shared["${key}"]`);
      assert.ok(!value.dimensions || Object.keys(value.dimensions).length === 0);
      alarm(value, metric, threshold, 3600);
    }
  }
}

const rewrite = runInNewContext(`${read("../spa-rewrite.js")}\nhandler`);
for (const [uri, accept, expected] of [
  ["/invites/example", "text/html,application/xhtml+xml", "/index.html"],
  ["/config.json", "text/html", "/config.json"],
  ["/service-worker.js", "text/html", "/service-worker.js"],
  ["/invites/example", "application/json", "/invites/example"],
]) {
  assert.equal(rewrite({ request: { method: "GET", uri, headers: { accept: { value: accept } } } }).uri, expected);
}
console.log("I10: both environment plans, shared resource ownership, JWT, IAM, monitoring and PWA routing passed.");
