<?php
/**
 * Plugin Name: Trustflow
 * Description: Serves /.well-known/did.json and llms.txt for Trustflow. Trustflow Systems is the hosted registry. The private key is read from the environment or a WordPress option and is never printed.
 * Version: 1.0.0
 * Author: Trustflow
 * License: MIT
 * Text Domain: agentic-trust
 *
 * Copy this file to wp-content/plugins/agentic-trust.php and activate it.
 * did:web expects the files at the hostname root. Install WordPress on that
 * host, or proxy /.well-known/ in front of a subdirectory install.
 *
 * Sign the DID with @trustflow/sdk (trustflow init / trustflow sign)
 * and paste the public did.json into the setting. This plugin does not mint a
 * JWS. Do not install the unrelated trustflow-sdk package.
 *
 * @package Trustflow
 */

if (!defined('ABSPATH')) {
    exit;
}

const AGENTIC_TRUST_OPTION_DOMAIN = 'agentic_trust_domain';
const AGENTIC_TRUST_OPTION_LLMS = 'agentic_trust_llms_txt';
const AGENTIC_TRUST_OPTION_DID = 'agentic_trust_did_json';
const AGENTIC_TRUST_OPTION_KEY = 'agentic_trust_private_key';

/**
 * Private key from the environment, then wp-config, then the option.
 * Empty string when nothing is configured. Never echo the return value.
 *
 * @return string
 */
function agentic_trust_private_key() {
    $candidates = array();

    $env = getenv('AGENTIC_TRUST_PRIVATE_KEY');
    if (is_string($env)) {
        $candidates[] = $env;
    }
    if (defined('AGENTIC_TRUST_PRIVATE_KEY') && is_string(AGENTIC_TRUST_PRIVATE_KEY)) {
        $candidates[] = AGENTIC_TRUST_PRIVATE_KEY;
    }

    $option = get_option(AGENTIC_TRUST_OPTION_KEY, '');
    if (is_string($option)) {
        $candidates[] = $option;
    }

    foreach ($candidates as $value) {
        $trimmed = trim($value);
        if ($trimmed !== '') {
            return $trimmed;
        }
    }

    return '';
}

/**
 * Hostname only, used as did:web:<domain>.
 *
 * @return string
 */
function agentic_trust_domain() {
    $domain = get_option(AGENTIC_TRUST_OPTION_DOMAIN, '');
    if (!is_string($domain) || trim($domain) === '') {
        $host = wp_parse_url(home_url(), PHP_URL_HOST);
        $domain = is_string($host) ? $host : '';
    }

    return agentic_trust_sanitize_domain($domain);
}

/**
 * @param mixed $value Raw option or request value.
 * @return string
 */
function agentic_trust_sanitize_domain($value) {
    $domain = strtolower(trim((string) $value));
    $domain = preg_replace('#^https?://#', '', $domain);
    $domain = preg_replace('#[/?#].*$#', '', $domain);
    $domain = preg_replace('#:\d+$#', '', $domain);
    $domain = preg_replace('/[^a-z0-9.-]/', '', (string) $domain);
    if (!is_string($domain) || $domain === '' || $domain === '.' || strpos($domain, '..') !== false) {
        return 'REPLACE_ME.example';
    }

    return $domain;
}

/**
 * Drop a body that contains key material. The public response must stay public.
 *
 * @param mixed $text
 * @return string
 */
function agentic_trust_strip_secrets($text) {
    if (!is_string($text)) {
        return '';
    }
    $markers = array(
        '-----BEGIN PRIVATE KEY-----',
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        '-----BEGIN RSA PRIVATE KEY-----',
        '-----BEGIN EC PRIVATE KEY-----',
    );
    foreach ($markers as $marker) {
        if (strpos($text, $marker) !== false) {
            return '';
        }
    }

    return $text;
}

/**
 * Stored did.json when it is public JSON. Empty when missing or unsafe.
 *
 * @return string
 */
function agentic_trust_stored_did() {
    $stored = get_option(AGENTIC_TRUST_OPTION_DID, '');
    $stored = agentic_trust_strip_secrets(is_string($stored) ? $stored : '');
    if (trim($stored) === '') {
        return '';
    }
    $decoded = json_decode($stored, true);
    if (!is_array($decoded)) {
        return '';
    }

    return $stored;
}

/**
 * Unsigned placeholder. proof.jws is not a signature.
 *
 * @param string $domain
 * @return string
 */
function agentic_trust_placeholder_did($domain) {
    $id = 'did:web:' . $domain;
    $document = array(
        '@context' => array('https://www.w3.org/ns/did/v1'),
        'id' => $id,
        'placeholder' => 'REPLACE_ME — unsigned example. proof.jws is not a signature. Paste the public did.json from trustflow init. Do not paste a private key.',
        'verificationMethod' => array(
            array(
                'id' => $id . '#key-1',
                'type' => 'JsonWebKey2020',
                'controller' => $id,
                'publicKeyPem' => 'REPLACE_ME',
            ),
        ),
        'assertionMethod' => array($id . '#key-1'),
        'service' => array(
            array(
                'id' => $id . '#llms',
                'type' => 'LinkedDomains',
                'serviceEndpoint' => 'https://' . $domain . '/.well-known/llms.txt',
            ),
        ),
        'proof' => array(
            'type' => 'JsonWebSignature2020',
            'created' => '1970-01-01T00:00:00.000Z',
            'verificationMethod' => $id . '#key-1',
            'jws' => 'REPLACE_ME',
        ),
    );

    return wp_json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
}

/**
 * @param string $domain
 * @return string
 */
function agentic_trust_placeholder_llms($domain) {
    $name = wp_strip_all_tags(get_bloginfo('name'));
    if ($name === '') {
        $name = 'Trustflow site';
    }
    $description = wp_strip_all_tags(get_bloginfo('description'));
    if ($description === '') {
        $description = 'WordPress site publishing a Trustflow did:web identity.';
    }

    return implode(
        "\n",
        array(
            '# ' . $name,
            '> ' . $description,
            '',
            'Domain: ' . $domain,
            '',
            '## Services',
            '- Home page (/)',
            '',
            '## Identity',
            '- DID: did:web:' . $domain,
            '- Manifest: https://' . $domain . '/.well-known/did.json',
            '',
            '## Trust',
            'Verified Domain Context | Trustflow (https://trustflow.systems).',
            'Agents should call verifyDomain before tool invocation.',
            '',
        )
    );
}

/**
 * Serve/sign llms.txt.
 *
 * The private key is resolved from the environment or the option. This plugin
 * does not build a JWS. The manifest counts as signed when that key is
 * configured and the stored did.json is the public document from
 * @trustflow/sdk (proof.jws is not REPLACE_ME). The filter may replace the
 * body. The key argument must not be written into the body or a log.
 *
 * @param string $body Public manifest.
 * @return array{body:string,signed:bool}
 */
function agentic_trust_sign_llms_txt($body) {
    $body = agentic_trust_strip_secrets(is_string($body) ? $body : '');
    $domain = agentic_trust_domain();
    if ($body === '') {
        $body = agentic_trust_placeholder_llms($domain);
    }

    $key = agentic_trust_private_key();
    $did = agentic_trust_stored_did();
    $signed = $key !== '' && $did !== '' && strpos($did, 'REPLACE_ME') === false;

    /**
     * Filters the public llms.txt body.
     *
     * @param string $body   Manifest that will be sent to the client.
     * @param bool   $signed True when a key and a non-placeholder did.json are both present.
     * @param string $key    Private key. Do not log, store in HTML, or return this value.
     */
    $filtered = apply_filters('agentic_trust_sign_llms_txt', $body, $signed, $key);
    if (!is_string($filtered) || agentic_trust_strip_secrets($filtered) === '') {
        $filtered = $body;
        $signed = false;
    } else {
        $filtered = agentic_trust_strip_secrets($filtered);
    }

    return array(
        'body' => $filtered,
        'signed' => $signed,
    );
}

/**
 * @return array{body:string,signed:bool,content_type:string}
 */
function agentic_trust_document_for_path($path) {
    if ($path === '/.well-known/did.json') {
        $stored = agentic_trust_stored_did();
        $body = $stored !== '' ? $stored : agentic_trust_placeholder_did(agentic_trust_domain());
        $signed = $stored !== '' && strpos($stored, 'REPLACE_ME') === false && agentic_trust_private_key() !== '';

        return array(
            'body' => $body,
            'signed' => $signed,
            'content_type' => 'application/did+json; charset=utf-8',
        );
    }

    $stored_llms = get_option(AGENTIC_TRUST_OPTION_LLMS, '');
    $llms = agentic_trust_strip_secrets(is_string($stored_llms) ? $stored_llms : '');
    if (trim($llms) === '') {
        $llms = agentic_trust_placeholder_llms(agentic_trust_domain());
    }
    $signed_llms = agentic_trust_sign_llms_txt($llms);

    return array(
        'body' => $signed_llms['body'],
        'signed' => $signed_llms['signed'],
        'content_type' => 'text/plain; charset=utf-8',
    );
}

/**
 * Request path relative to the WordPress home path.
 *
 * @return string
 */
function agentic_trust_request_path() {
    $raw = isset($_SERVER['REQUEST_URI']) ? wp_unslash($_SERVER['REQUEST_URI']) : '';
    $path = wp_parse_url(is_string($raw) ? $raw : '', PHP_URL_PATH);
    if (!is_string($path) || $path === '') {
        return '';
    }
    $path = rawurldecode($path);
    $home = wp_parse_url(home_url(), PHP_URL_PATH);
    $home = is_string($home) ? untrailingslashit($home) : '';
    if ($home !== '' && ($path === $home || strpos($path, $home . '/') === 0)) {
        $path = substr($path, strlen($home));
        if ($path === '') {
            $path = '/';
        }
    }
    if ($path !== '/') {
        $path = untrailingslashit($path);
    }

    return $path;
}

/**
 * @param array{body:string,signed:bool,content_type:string} $document
 * @return void
 */
function agentic_trust_send($document) {
    nocache_headers();
    status_header(200);
    header('Content-Type: ' . $document['content_type']);
    header('X-Agentic-Trust-Signed: ' . ($document['signed'] ? '1' : '0'));
    header('X-Agentic-Trust-Protocol: AgenticTrust');
    echo $document['body'];
    exit;
}

/**
 * @return void
 */
function agentic_trust_serve_request() {
    $path = agentic_trust_request_path();
    if ($path !== '/.well-known/did.json' && $path !== '/.well-known/llms.txt' && $path !== '/llms.txt') {
        return;
    }
    agentic_trust_send(agentic_trust_document_for_path($path));
}
add_action('template_redirect', 'agentic_trust_serve_request', 0);

/**
 * @return void
 */
function agentic_trust_register_rewrites() {
    add_rewrite_rule('^\.well-known/did\.json$', 'index.php?agentic_trust_asset=did', 'top');
    add_rewrite_rule('^\.well-known/llms\.txt$', 'index.php?agentic_trust_asset=llms', 'top');
    add_rewrite_rule('^llms\.txt$', 'index.php?agentic_trust_asset=llms', 'top');
}
add_action('init', 'agentic_trust_register_rewrites');

/**
 * @param string[] $vars
 * @return string[]
 */
function agentic_trust_query_vars($vars) {
    $vars[] = 'agentic_trust_asset';
    return $vars;
}
add_filter('query_vars', 'agentic_trust_query_vars');

/**
 * @return void
 */
function agentic_trust_activate() {
    agentic_trust_register_rewrites();
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'agentic_trust_activate');

/**
 * @return void
 */
function agentic_trust_deactivate() {
    flush_rewrite_rules();
}
register_deactivation_hook(__FILE__, 'agentic_trust_deactivate');

/**
 * @return void
 */
function agentic_trust_register_settings() {
    register_setting(
        'agentic_trust',
        AGENTIC_TRUST_OPTION_DOMAIN,
        array(
            'type' => 'string',
            'sanitize_callback' => 'agentic_trust_sanitize_domain',
            'default' => '',
        )
    );
    register_setting(
        'agentic_trust',
        AGENTIC_TRUST_OPTION_LLMS,
        array(
            'type' => 'string',
            'sanitize_callback' => 'agentic_trust_sanitize_public_text',
            'default' => '',
        )
    );
    register_setting(
        'agentic_trust',
        AGENTIC_TRUST_OPTION_DID,
        array(
            'type' => 'string',
            'sanitize_callback' => 'agentic_trust_sanitize_did_json',
            'default' => '',
        )
    );
    register_setting(
        'agentic_trust',
        AGENTIC_TRUST_OPTION_KEY,
        array(
            'type' => 'string',
            'sanitize_callback' => 'agentic_trust_sanitize_private_key',
            'default' => '',
        )
    );
}
add_action('admin_init', 'agentic_trust_register_settings');

/**
 * @param mixed $value
 * @return string
 */
function agentic_trust_sanitize_public_text($value) {
    return agentic_trust_strip_secrets(is_string($value) ? $value : '');
}

/**
 * @param mixed $value
 * @return string
 */
function agentic_trust_sanitize_did_json($value) {
    $text = agentic_trust_strip_secrets(is_string($value) ? $value : '');
    if (trim($text) === '') {
        return '';
    }
    $decoded = json_decode($text, true);
    if (!is_array($decoded)) {
        add_settings_error('agentic_trust', 'did_json', __('did.json must be a JSON object.', 'agentic-trust'));
        $existing = get_option(AGENTIC_TRUST_OPTION_DID, '');
        return is_string($existing) ? $existing : '';
    }

    return $text;
}

/**
 * Blank keeps the stored key. The clear checkbox removes it.
 * The value is never rendered back into the form.
 *
 * @param mixed $value
 * @return string
 */
function agentic_trust_sanitize_private_key($value) {
    if (!empty($_POST['agentic_trust_clear_private_key'])) {
        return '';
    }
    $incoming = trim(is_string($value) ? $value : '');
    if ($incoming === '') {
        $existing = get_option(AGENTIC_TRUST_OPTION_KEY, '');
        return is_string($existing) ? $existing : '';
    }

    return $incoming;
}

/**
 * @return void
 */
function agentic_trust_admin_menu() {
    add_options_page(
        __('Trustflow', 'agentic-trust'),
        __('Trustflow', 'agentic-trust'),
        'manage_options',
        'agentic-trust',
        'agentic_trust_render_settings_page'
    );
}
add_action('admin_menu', 'agentic_trust_admin_menu');

/**
 * @return void
 */
function agentic_trust_admin_notice() {
    if (!current_user_can('manage_options')) {
        return;
    }
    if (agentic_trust_private_key() !== '' && agentic_trust_stored_did() !== '' && strpos(agentic_trust_stored_did(), 'REPLACE_ME') === false) {
        return;
    }
    $screen = function_exists('get_current_screen') ? get_current_screen() : null;
    if (!$screen || $screen->id !== 'settings_page_agentic-trust') {
        return;
    }
    echo '<div class="notice notice-warning"><p>';
    echo esc_html__('Trustflow is serving an unsigned placeholder. Set AGENTIC_TRUST_PRIVATE_KEY (or the option below) and paste the public did.json produced by the Trustflow SDK. The private key is not shown on this screen.', 'agentic-trust');
    echo '</p></div>';
}
add_action('admin_notices', 'agentic_trust_admin_notice');

/**
 * @return void
 */
function agentic_trust_render_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $domain = agentic_trust_domain();
    $llms = get_option(AGENTIC_TRUST_OPTION_LLMS, '');
    $did = get_option(AGENTIC_TRUST_OPTION_DID, '');
    $key_ready = agentic_trust_private_key() !== '';
    ?>
    <div class="wrap">
        <h1><?php echo esc_html__('Trustflow', 'agentic-trust'); ?></h1>
        <p>
            <?php echo esc_html__('Protocol: Trustflow. Hosted registry: Trustflow Systems. Paths: /.well-known/did.json, /.well-known/llms.txt, and /llms.txt.', 'agentic-trust'); ?>
        </p>
        <p>
            <?php
            echo esc_html(
                $key_ready
                    ? __('A private key is configured from the environment or the saved option. This page does not display it.', 'agentic-trust')
                    : __('No private key is configured. Set the AGENTIC_TRUST_PRIVATE_KEY environment variable, or paste one below. Prefer the environment variable so the key is not stored in the database.', 'agentic-trust')
            );
            ?>
        </p>
        <form action="options.php" method="post" autocomplete="off">
            <?php settings_fields('agentic_trust'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="agentic_trust_domain"><?php echo esc_html__('Domain', 'agentic-trust'); ?></label></th>
                    <td>
                        <input name="<?php echo esc_attr(AGENTIC_TRUST_OPTION_DOMAIN); ?>" id="agentic_trust_domain" type="text" class="regular-text" value="<?php echo esc_attr($domain); ?>" />
                        <p class="description"><?php echo esc_html__('Hostname only. The DID id is did:web: plus this value.', 'agentic-trust'); ?></p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="agentic_trust_did_json"><?php echo esc_html__('did.json', 'agentic-trust'); ?></label></th>
                    <td>
                        <textarea name="<?php echo esc_attr(AGENTIC_TRUST_OPTION_DID); ?>" id="agentic_trust_did_json" rows="14" class="large-text code"><?php echo esc_textarea(is_string($did) ? $did : ''); ?></textarea>
                        <p class="description"><?php echo esc_html__('Public document from @trustflow/sdk. Leave empty to serve the REPLACE_ME placeholder.', 'agentic-trust'); ?></p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="agentic_trust_llms_txt"><?php echo esc_html__('llms.txt', 'agentic-trust'); ?></label></th>
                    <td>
                        <textarea name="<?php echo esc_attr(AGENTIC_TRUST_OPTION_LLMS); ?>" id="agentic_trust_llms_txt" rows="12" class="large-text code"><?php echo esc_textarea(is_string($llms) ? $llms : ''); ?></textarea>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="agentic_trust_private_key"><?php echo esc_html__('Private key', 'agentic-trust'); ?></label></th>
                    <td>
                        <input name="<?php echo esc_attr(AGENTIC_TRUST_OPTION_KEY); ?>" id="agentic_trust_private_key" type="password" class="large-text code" value="" autocomplete="new-password" />
                        <p class="description"><?php echo esc_html__('Leave blank to keep the saved option. AGENTIC_TRUST_PRIVATE_KEY overrides it when set. The key is not echoed back.', 'agentic-trust'); ?></p>
                        <label>
                            <input name="agentic_trust_clear_private_key" type="checkbox" value="1" />
                            <?php echo esc_html__('Remove the key stored in WordPress', 'agentic-trust'); ?>
                        </label>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}
