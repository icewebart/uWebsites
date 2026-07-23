<?php
/**
 * Plugin Name:       uWebsites
 * Plugin URI:        https://uwebsites.net
 * Description:       Publishes AI-written, SEO-optimised articles from your uWebsites account straight into this site — with featured images and SEO meta.
 * Version:           1.0.0
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * Author:            uWebsites
 * Author URI:        https://uwebsites.net
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       uwebsites
 */

if ( ! defined( 'ABSPATH' ) ) { exit; } // no direct access

define( 'UW_VERSION', '1.0.0' );
define( 'UW_OPT_TOKEN', 'uw_site_token' );
define( 'UW_OPT_STATUS', 'uw_default_status' );
define( 'UW_OPT_CATEGORY', 'uw_default_category' );
define( 'UW_OPT_LAST', 'uw_last_received' );
define( 'UW_META_EXTERNAL', '_uw_external_id' );

/* -------------------------------------------------------------------------
 * Token
 * ---------------------------------------------------------------------- */

function uw_get_token() {
	$t = get_option( UW_OPT_TOKEN );
	if ( ! $t ) { $t = uw_regenerate_token(); }
	return $t;
}

function uw_regenerate_token() {
	$t = bin2hex( random_bytes( 32 ) );
	update_option( UW_OPT_TOKEN, $t, false ); // not autoloaded
	return $t;
}

/** The single string the user pastes into uWebsites: site URL + token. */
function uw_connection_code() {
	return base64_encode( home_url() . '|' . uw_get_token() );
}

/**
 * Auth for every REST call. Timing-safe compare, and we never reveal whether
 * the header was missing vs wrong.
 */
function uw_authorize( WP_REST_Request $req ) {
	$sent = $req->get_header( 'x_uw_token' );
	if ( ! $sent ) { $sent = $req->get_header( 'X-UW-Token' ); }
	$known = uw_get_token();
	if ( ! $sent || ! $known || ! hash_equals( $known, (string) $sent ) ) {
		return new WP_Error( 'uw_forbidden', 'Invalid or missing token.', array( 'status' => 401 ) );
	}
	return true;
}

/* -------------------------------------------------------------------------
 * REST API
 * ---------------------------------------------------------------------- */

add_action( 'rest_api_init', function () {
	register_rest_route( 'uwebsites/v1', '/status', array(
		'methods'             => 'GET',
		'permission_callback' => 'uw_authorize',
		'callback'            => 'uw_rest_status',
	) );
	register_rest_route( 'uwebsites/v1', '/article', array(
		'methods'             => 'POST',
		'permission_callback' => 'uw_authorize',
		'callback'            => 'uw_rest_article',
	) );
} );

function uw_rest_status() {
	return array(
		'ok'          => true,
		'plugin'      => UW_VERSION,
		'site'        => get_bloginfo( 'name' ),
		'url'         => home_url(),
		'wp'          => get_bloginfo( 'version' ),
		// Token auth is site-level (the owner installed the plugin), so there is
		// no per-user capability to check here.
		'canPublish'  => true,
		'seo'         => uw_active_seo_plugin(),
		'defaults'    => array(
			'status'   => get_option( UW_OPT_STATUS, 'draft' ),
			'category' => (int) get_option( UW_OPT_CATEGORY, 0 ),
			'author'   => uw_default_author(),
		),
	);
}

/**
 * Which user to attribute posts to. Token auth has no logged-in user, so
 * wp_insert_post would otherwise write post_author = 0 (an authorless post that
 * breaks author archives and most themes' bylines). Falls back to the first
 * administrator.
 */
function uw_default_author() {
	$a = (int) get_option( 'uw_default_author', 0 );
	if ( $a && get_userdata( $a ) ) { return $a; }
	$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID', 'orderby' => 'ID' ) );
	return ! empty( $admins ) ? (int) $admins[0] : 1;
}

/** Which SEO plugin is active, so uWebsites knows meta will be honoured. */
function uw_active_seo_plugin() {
	if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Meta' ) ) { return 'yoast'; }
	if ( class_exists( 'RankMath' ) ) { return 'rankmath'; }
	if ( defined( 'AIOSEO_VERSION' ) ) { return 'aioseo'; }
	return 'none';
}

/**
 * Create (or update) a post from uWebsites.
 *
 * Body: { external_id, title, content, excerpt, slug, status, meta_title,
 *         meta_description, image_url, image_alt, categories[], tags[] }
 */
function uw_rest_article( WP_REST_Request $req ) {
	$b     = $req->get_json_params();
	$title = isset( $b['title'] ) ? sanitize_text_field( $b['title'] ) : '';
	if ( '' === $title ) {
		return new WP_Error( 'uw_bad_request', 'title is required', array( 'status' => 400 ) );
	}

	// wp_kses_post keeps article markup (p/h2/ul/a/table…) and strips anything
	// unsafe — we never trust remote HTML verbatim, even from ourselves.
	$content = isset( $b['content'] ) ? wp_kses_post( $b['content'] ) : '';
	$excerpt = isset( $b['excerpt'] ) ? sanitize_text_field( $b['excerpt'] ) : '';
	$slug    = isset( $b['slug'] ) ? sanitize_title( $b['slug'] ) : '';
	$status  = isset( $b['status'] ) ? sanitize_key( $b['status'] ) : get_option( UW_OPT_STATUS, 'draft' );
	if ( ! in_array( $status, array( 'draft', 'publish', 'pending', 'future' ), true ) ) { $status = 'draft'; }

	$external = isset( $b['external_id'] ) ? sanitize_text_field( $b['external_id'] ) : '';

	// Idempotency — a retried delivery must update, never duplicate.
	$existing = 0;
	if ( $external ) {
		$found = get_posts( array(
			'post_type'      => 'post',
			'post_status'    => 'any',
			'meta_key'       => UW_META_EXTERNAL,
			'meta_value'     => $external,
			'fields'         => 'ids',
			'posts_per_page' => 1,
		) );
		if ( ! empty( $found ) ) { $existing = (int) $found[0]; }
	}

	$postarr = array(
		'post_title'   => $title,
		'post_content' => $content,
		'post_excerpt' => $excerpt,
		'post_status'  => $status,
		'post_type'    => 'post',
		'post_author'  => uw_default_author(),
	);
	if ( $slug ) { $postarr['post_name'] = $slug; }
	if ( $existing ) { $postarr['ID'] = $existing; }

	$default_cat = (int) get_option( UW_OPT_CATEGORY, 0 );
	if ( $default_cat ) { $postarr['post_category'] = array( $default_cat ); }

	$post_id = $existing ? wp_update_post( $postarr, true ) : wp_insert_post( $postarr, true );
	if ( is_wp_error( $post_id ) ) {
		return new WP_Error( 'uw_insert_failed', $post_id->get_error_message(), array( 'status' => 500 ) );
	}

	if ( $external ) { update_post_meta( $post_id, UW_META_EXTERNAL, $external ); }

	// Tags (categories come from the setting above; tags are per-article).
	if ( ! empty( $b['tags'] ) && is_array( $b['tags'] ) ) {
		wp_set_post_tags( $post_id, array_map( 'sanitize_text_field', $b['tags'] ), false );
	}

	// Featured image — sideload into the client's own media library so nothing
	// hotlinks back to us.
	if ( ! empty( $b['image_url'] ) ) {
		$thumb = uw_sideload_featured( esc_url_raw( $b['image_url'] ), $post_id, isset( $b['image_alt'] ) ? sanitize_text_field( $b['image_alt'] ) : $title );
		if ( $thumb ) { set_post_thumbnail( $post_id, $thumb ); }
	}

	// SEO meta — this is the bit the plain REST API can't do.
	uw_write_seo_meta( $post_id, isset( $b['meta_title'] ) ? sanitize_text_field( $b['meta_title'] ) : '', isset( $b['meta_description'] ) ? sanitize_text_field( $b['meta_description'] ) : '' );

	update_option( UW_OPT_LAST, array( 'at' => current_time( 'mysql' ), 'title' => $title, 'id' => $post_id ), false );

	return array(
		'ok'      => true,
		'id'      => $post_id,
		'link'    => get_permalink( $post_id ),
		'status'  => get_post_status( $post_id ),
		'updated' => (bool) $existing,
	);
}

function uw_sideload_featured( $url, $post_id, $alt ) {
	if ( ! $url ) { return 0; }
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$id = media_sideload_image( $url, $post_id, $alt, 'id' );
	if ( is_wp_error( $id ) ) { return 0; }
	update_post_meta( $id, '_wp_attachment_image_alt', $alt );
	return (int) $id;
}

/** Write meta title/description for whichever SEO plugin is installed. */
function uw_write_seo_meta( $post_id, $meta_title, $meta_desc ) {
	if ( ! $meta_title && ! $meta_desc ) { return; }
	switch ( uw_active_seo_plugin() ) {
		case 'yoast':
			if ( $meta_title ) { update_post_meta( $post_id, '_yoast_wpseo_title', $meta_title ); }
			if ( $meta_desc ) { update_post_meta( $post_id, '_yoast_wpseo_metadesc', $meta_desc ); }
			break;
		case 'rankmath':
			if ( $meta_title ) { update_post_meta( $post_id, 'rank_math_title', $meta_title ); }
			if ( $meta_desc ) { update_post_meta( $post_id, 'rank_math_description', $meta_desc ); }
			break;
		case 'aioseo':
			if ( $meta_title ) { update_post_meta( $post_id, '_aioseo_title', $meta_title ); }
			if ( $meta_desc ) { update_post_meta( $post_id, '_aioseo_description', $meta_desc ); }
			break;
		default:
			// No SEO plugin — keep the values so they're available if one is installed later.
			if ( $meta_desc ) { update_post_meta( $post_id, '_uw_meta_description', $meta_desc ); }
			break;
	}
}

/* -------------------------------------------------------------------------
 * Admin screen
 * ---------------------------------------------------------------------- */

add_action( 'admin_menu', function () {
	add_options_page( 'uWebsites', 'uWebsites', 'manage_options', 'uwebsites', 'uw_admin_page' );
} );

add_action( 'admin_init', function () {
	register_setting( 'uw_settings', UW_OPT_STATUS, array( 'sanitize_callback' => 'sanitize_key', 'default' => 'draft' ) );
	register_setting( 'uw_settings', UW_OPT_CATEGORY, array( 'sanitize_callback' => 'absint', 'default' => 0 ) );
	register_setting( 'uw_settings', 'uw_default_author', array( 'sanitize_callback' => 'absint', 'default' => 0 ) );
} );

function uw_admin_page() {
	if ( ! current_user_can( 'manage_options' ) ) { return; }

	if ( isset( $_POST['uw_regen'] ) && check_admin_referer( 'uw_regen_token' ) ) {
		uw_regenerate_token();
		echo '<div class="notice notice-success"><p>New connection code generated. Paste it into uWebsites again — the old one no longer works.</p></div>';
	}

	$last = get_option( UW_OPT_LAST );
	$seo  = uw_active_seo_plugin();
	?>
	<div class="wrap">
		<h1>uWebsites</h1>
		<p>Publish AI-written articles from your uWebsites account straight into this site.</p>

		<h2>1. Connect</h2>
		<p>Copy this connection code and paste it into uWebsites (Workspace → WordPress):</p>
		<textarea readonly onclick="this.select()" style="width:100%;max-width:640px;height:70px;font-family:monospace;"><?php echo esc_textarea( uw_connection_code() ); ?></textarea>
		<form method="post" style="margin-top:8px;">
			<?php wp_nonce_field( 'uw_regen_token' ); ?>
			<button class="button" name="uw_regen" value="1" onclick="return confirm('Generate a new code? uWebsites will stop publishing until you paste the new one.')">Regenerate code</button>
		</form>

		<h2 style="margin-top:28px;">2. Defaults</h2>
		<form method="post" action="options.php">
			<?php settings_fields( 'uw_settings' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="uw_status">New articles arrive as</label></th>
					<td>
						<select name="<?php echo esc_attr( UW_OPT_STATUS ); ?>" id="uw_status">
							<?php $st = get_option( UW_OPT_STATUS, 'draft' ); ?>
							<option value="draft" <?php selected( $st, 'draft' ); ?>>Draft (you review, then publish)</option>
							<option value="publish" <?php selected( $st, 'publish' ); ?>>Published immediately</option>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="uw_cat">Default category</label></th>
					<td><?php wp_dropdown_categories( array( 'name' => UW_OPT_CATEGORY, 'id' => 'uw_cat', 'selected' => (int) get_option( UW_OPT_CATEGORY, 0 ), 'show_option_none' => '— none —', 'option_none_value' => 0, 'hide_empty' => 0 ) ); ?></td>
				</tr>
				<tr>
					<th scope="row"><label for="uw_author">Publish as</label></th>
					<td>
						<?php wp_dropdown_users( array( 'name' => 'uw_default_author', 'id' => 'uw_author', 'selected' => uw_default_author(), 'who' => 'authors' ) ); ?>
						<p class="description">Articles are attributed to this user.</p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<h2 style="margin-top:28px;">Status</h2>
		<table class="widefat striped" style="max-width:640px;">
			<tr><td><strong>SEO plugin detected</strong></td><td><?php echo 'none' === $seo ? 'none — meta will be stored but not shown' : esc_html( ucfirst( $seo ) ); ?></td></tr>
			<tr><td><strong>Last article received</strong></td><td>
				<?php if ( $last && ! empty( $last['title'] ) ) : ?>
					<a href="<?php echo esc_url( get_edit_post_link( $last['id'] ) ); ?>"><?php echo esc_html( $last['title'] ); ?></a> — <?php echo esc_html( $last['at'] ); ?>
				<?php else : ?>nothing yet<?php endif; ?>
			</td></tr>
		</table>
	</div>
	<?php
}
