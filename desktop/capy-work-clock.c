#include <gtk/gtk.h>
#include <jsc/jsc.h>
#include <webkit2/webkit2.h>

#define APP_ID "com.capyworkclock.Timer"
#define APP_VERSION "1.0.0"

typedef struct {
  GtkApplication *application;
  GtkWidget *window;
  gchar *asset_root;
  gchar *asset_root_uri;
  gboolean smoke_test;
  gboolean smoke_finished;
  gboolean smoke_succeeded;
} AppState;

static const gchar *required_assets[] = {
    "index.html",
    "boundary-clock-icon.webp",
    "favicon.png",
    "meadow-desk.webp",
    "state-break-four-toes.webp",
    "state-eod.webp",
    "state-idle.webp",
    NULL,
};

static gchar *find_asset_root(void) {
  const gchar *override = g_getenv("CAPY_WORK_CLOCK_DIST");
  if (override && *override) {
    return g_canonicalize_filename(override, NULL);
  }

  const gchar *snap = g_getenv("SNAP");
  if (snap && *snap) {
    return g_build_filename(snap, "usr", "share", "capy-work-clock", NULL);
  }

  return g_canonicalize_filename("dist-desktop", NULL);
}

static gboolean check_assets(const gchar *asset_root, GError **error) {
  for (const gchar **file_name = required_assets; *file_name; file_name++) {
    g_autofree gchar *path = g_build_filename(asset_root, *file_name, NULL);
    if (!g_file_test(path, G_FILE_TEST_IS_REGULAR)) {
      g_set_error(error, G_FILE_ERROR, G_FILE_ERROR_NOENT,
                  "Required desktop asset is missing: %s", path);
      return FALSE;
    }
  }
  return TRUE;
}

static gboolean choose_download_destination(WebKitDownload *download,
                                            const gchar *suggested_filename,
                                            gpointer user_data) {
  GtkWindow *window = GTK_WINDOW(user_data);
  GtkFileChooserNative *chooser = gtk_file_chooser_native_new(
      "Save clock backup", window, GTK_FILE_CHOOSER_ACTION_SAVE, "Save",
      "Cancel");
  gtk_file_chooser_set_current_name(GTK_FILE_CHOOSER(chooser),
                                    suggested_filename);
  gtk_file_chooser_set_do_overwrite_confirmation(GTK_FILE_CHOOSER(chooser),
                                                  TRUE);

  GtkFileFilter *filter = gtk_file_filter_new();
  gtk_file_filter_set_name(filter, "JSON backup");
  gtk_file_filter_add_mime_type(filter, "application/json");
  gtk_file_filter_add_pattern(filter, "*.json");
  gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(chooser), filter);

  if (gtk_native_dialog_run(GTK_NATIVE_DIALOG(chooser)) ==
      GTK_RESPONSE_ACCEPT) {
    g_autofree gchar *destination =
        gtk_file_chooser_get_uri(GTK_FILE_CHOOSER(chooser));
    webkit_download_set_allow_overwrite(download, TRUE);
    webkit_download_set_destination(download, destination);
  } else {
    webkit_download_cancel(download);
  }

  g_object_unref(chooser);
  return TRUE;
}

static void download_started(WebKitWebContext *context,
                             WebKitDownload *download, gpointer user_data) {
  (void)context;
  g_signal_connect(download, "decide-destination",
                   G_CALLBACK(choose_download_destination), user_data);
}

static gboolean decide_policy(WebKitWebView *web_view,
                              WebKitPolicyDecision *decision,
                              WebKitPolicyDecisionType decision_type,
                              gpointer user_data) {
  (void)web_view;
  AppState *state = user_data;
  if (decision_type != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION &&
      decision_type != WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
    return FALSE;
  }

  WebKitNavigationPolicyDecision *navigation =
      WEBKIT_NAVIGATION_POLICY_DECISION(decision);
  WebKitNavigationAction *action =
      webkit_navigation_policy_decision_get_navigation_action(navigation);
  WebKitURIRequest *request = webkit_navigation_action_get_request(action);
  const gchar *uri = webkit_uri_request_get_uri(request);
  if (g_str_has_prefix(uri, state->asset_root_uri) ||
      g_str_has_prefix(uri, "blob:file:") ||
      g_str_equal(uri, "about:blank")) {
    return FALSE;
  }

  webkit_policy_decision_ignore(decision);
  return TRUE;
}

static gboolean load_failed(WebKitWebView *web_view, WebKitLoadEvent load_event,
                            const gchar *failing_uri, GError *error,
                            gpointer user_data) {
  (void)web_view;
  (void)load_event;
  (void)failing_uri;
  AppState *state = user_data;
  if (g_error_matches(error, WEBKIT_NETWORK_ERROR,
                      WEBKIT_NETWORK_ERROR_CANCELLED)) {
    return FALSE;
  }

  g_printerr("Capy Work Clock could not load: %s\n", error->message);
  if (state->smoke_test) {
    state->smoke_finished = TRUE;
    g_application_quit(G_APPLICATION(state->application));
    return TRUE;
  }

  GtkWidget *dialog = gtk_message_dialog_new(
      GTK_WINDOW(state->window), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR,
      GTK_BUTTONS_CLOSE, "Capy Work Clock could not open its local files.");
  gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dialog), "%s",
                                           error->message);
  gtk_dialog_run(GTK_DIALOG(dialog));
  gtk_widget_destroy(dialog);
  return TRUE;
}

static void smoke_javascript_finished(GObject *object, GAsyncResult *result,
                                      gpointer user_data) {
  AppState *state = user_data;
  g_autoptr(GError) error = NULL;
  JSCValue *value = webkit_web_view_evaluate_javascript_finish(
      WEBKIT_WEB_VIEW(object), result, &error);

  if (value && jsc_value_is_boolean(value)) {
    state->smoke_succeeded = jsc_value_to_boolean(value);
  } else if (error) {
    g_printerr("Desktop runtime smoke test failed: %s\n", error->message);
  }
  if (value) {
    g_object_unref(value);
  }

  state->smoke_finished = TRUE;
  if (state->smoke_succeeded) {
    g_print("Desktop runtime loaded and IndexedDB storage is available.\n");
  }
  g_application_quit(G_APPLICATION(state->application));
}

static gboolean run_smoke_javascript(gpointer user_data) {
  AppState *state = user_data;
  WebKitWebView *web_view = WEBKIT_WEB_VIEW(
      gtk_bin_get_child(GTK_BIN(state->window)));
  const gchar *script =
      "document.querySelector('.app-shell') !== null && "
      "typeof indexedDB !== 'undefined' && "
      "document.querySelector('.storage-error') === null";
  webkit_web_view_evaluate_javascript(
      web_view, script, -1, NULL, NULL, NULL, smoke_javascript_finished, state);
  return G_SOURCE_REMOVE;
}

static gboolean smoke_timeout(gpointer user_data) {
  AppState *state = user_data;
  if (!state->smoke_finished) {
    g_printerr("Desktop runtime smoke test timed out.\n");
    g_application_quit(G_APPLICATION(state->application));
  }
  return G_SOURCE_REMOVE;
}

static void load_changed(WebKitWebView *web_view, WebKitLoadEvent load_event,
                         gpointer user_data) {
  (void)web_view;
  AppState *state = user_data;
  if (state->smoke_test && load_event == WEBKIT_LOAD_FINISHED) {
    g_timeout_add(1000, run_smoke_javascript, state);
  }
}

static void activate(GtkApplication *application, gpointer user_data) {
  AppState *state = user_data;
  if (state->window) {
    gtk_window_present(GTK_WINDOW(state->window));
    return;
  }

  const gchar *common_dir = g_getenv("SNAP_USER_COMMON");
  const gchar *revision_dir = g_getenv("SNAP_USER_DATA");
  g_autofree gchar *data_dir = g_build_filename(
      common_dir && *common_dir ? common_dir : g_get_user_data_dir(),
      "webkit", NULL);
  g_autofree gchar *cache_dir = g_build_filename(
      revision_dir && *revision_dir ? revision_dir : g_get_user_cache_dir(),
      "webkit", NULL);
  g_mkdir_with_parents(data_dir, 0700);
  g_mkdir_with_parents(cache_dir, 0700);

  WebKitWebsiteDataManager *data_manager = webkit_website_data_manager_new(
      "base-data-directory", data_dir, "base-cache-directory", cache_dir,
      NULL);
  WebKitWebContext *context =
      webkit_web_context_new_with_website_data_manager(data_manager);
  webkit_web_context_set_cache_model(context,
                                     WEBKIT_CACHE_MODEL_DOCUMENT_VIEWER);

  state->window = gtk_application_window_new(application);
  gtk_window_set_title(GTK_WINDOW(state->window), "Capy Work Clock");
  gtk_window_set_default_size(GTK_WINDOW(state->window), 1100, 780);
  gtk_window_set_role(GTK_WINDOW(state->window), "capy-work-clock");

  GtkWidget *web_view = webkit_web_view_new_with_context(context);
  WebKitSettings *settings =
      webkit_web_view_get_settings(WEBKIT_WEB_VIEW(web_view));
  webkit_settings_set_allow_file_access_from_file_urls(settings, TRUE);
  webkit_settings_set_enable_developer_extras(settings, FALSE);
  webkit_settings_set_javascript_can_open_windows_automatically(settings,
                                                                FALSE);
  webkit_settings_set_enable_html5_local_storage(settings, TRUE);

  GdkRGBA background = {0.9647, 0.9412, 0.8902, 1.0};
  webkit_web_view_set_background_color(WEBKIT_WEB_VIEW(web_view), &background);

  g_signal_connect(context, "download-started", G_CALLBACK(download_started),
                   state->window);
  g_signal_connect(web_view, "decide-policy", G_CALLBACK(decide_policy), state);
  g_signal_connect(web_view, "load-failed", G_CALLBACK(load_failed), state);
  g_signal_connect(web_view, "load-changed", G_CALLBACK(load_changed), state);

  gtk_container_add(GTK_CONTAINER(state->window), web_view);
  gtk_widget_show_all(state->window);

  g_autofree gchar *index_path =
      g_build_filename(state->asset_root, "index.html", NULL);
  g_autoptr(GError) uri_error = NULL;
  g_autofree gchar *index_uri = g_filename_to_uri(index_path, NULL, &uri_error);
  if (!index_uri) {
    g_printerr("Could not create the desktop entry URI: %s\n",
               uri_error->message);
    g_application_quit(G_APPLICATION(application));
    return;
  }
  webkit_web_view_load_uri(WEBKIT_WEB_VIEW(web_view), index_uri);

  if (state->smoke_test) {
    g_timeout_add_seconds(20, smoke_timeout, state);
  }

  g_object_unref(context);
  g_object_unref(data_manager);
}

int main(int argc, char **argv) {
  gboolean check_only = argc == 2 && g_str_equal(argv[1], "--check");
  gboolean smoke_test = argc == 2 && g_str_equal(argv[1], "--smoke-test");
  if (argc == 2 && g_str_equal(argv[1], "--version")) {
    g_print("capy-work-clock %s\n", APP_VERSION);
    return 0;
  }

  AppState state = {0};
  state.asset_root = find_asset_root();
  g_autoptr(GError) asset_error = NULL;
  if (!check_assets(state.asset_root, &asset_error)) {
    g_printerr("%s\n", asset_error->message);
    g_free(state.asset_root);
    return 1;
  }

  if (check_only) {
    g_print("Desktop assets are complete: %s\n", state.asset_root);
    g_free(state.asset_root);
    return 0;
  }

  g_autoptr(GError) uri_error = NULL;
  state.asset_root_uri =
      g_filename_to_uri(state.asset_root, NULL, &uri_error);
  if (!state.asset_root_uri) {
    g_printerr("Could not resolve desktop assets: %s\n", uri_error->message);
    g_free(state.asset_root);
    return 1;
  }
  if (!g_str_has_suffix(state.asset_root_uri, "/")) {
    gchar *with_separator = g_strconcat(state.asset_root_uri, "/", NULL);
    g_free(state.asset_root_uri);
    state.asset_root_uri = with_separator;
  }

  state.smoke_test = smoke_test;
  state.application =
      gtk_application_new(APP_ID, G_APPLICATION_NON_UNIQUE);
  g_signal_connect(state.application, "activate", G_CALLBACK(activate), &state);

  int gtk_argc = smoke_test ? 1 : argc;
  int status = g_application_run(G_APPLICATION(state.application), gtk_argc,
                                 argv);
  if (smoke_test && !state.smoke_succeeded) {
    status = 1;
  }

  g_clear_object(&state.application);
  g_free(state.asset_root_uri);
  g_free(state.asset_root);
  return status;
}
