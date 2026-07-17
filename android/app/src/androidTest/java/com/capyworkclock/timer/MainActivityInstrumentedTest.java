package com.capyworkclock.timer;

import static androidx.test.espresso.web.assertion.WebViewAssertions.webMatches;
import static androidx.test.espresso.web.sugar.Web.onWebView;
import static androidx.test.espresso.web.webdriver.DriverAtoms.findElement;
import static androidx.test.espresso.web.webdriver.DriverAtoms.getText;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import android.Manifest;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.espresso.web.webdriver.Locator;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MainActivityInstrumentedTest {

    @Test
    public void privacyConfigurationDisablesBackupAndInternet() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ApplicationInfo applicationInfo = context
            .getPackageManager()
            .getApplicationInfo(context.getPackageName(), 0);

        assertEquals("com.capyworkclock.timer", context.getPackageName());
        assertFalse((applicationInfo.flags & ApplicationInfo.FLAG_ALLOW_BACKUP) != 0);
        assertEquals(
            PackageManager.PERMISSION_DENIED,
            context.getPackageManager().checkPermission(Manifest.permission.INTERNET, context.getPackageName())
        );
    }

    @Test
    public void clockSurvivesBackgroundAndActivityRecreation() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            onWebView()
                .forceJavascriptEnabled()
                .withElement(findElement(Locator.CSS_SELECTOR, ".brand"))
                .check(webMatches(getText(), containsString("Capybara Healthy Work Boundaries Clock")));

            scenario.moveToState(Lifecycle.State.CREATED);
            scenario.moveToState(Lifecycle.State.RESUMED);
            scenario.recreate();

            onWebView()
                .withElement(findElement(Locator.CSS_SELECTOR, ".today-time"))
                .check(webMatches(getText(), containsString(":")));
        }
    }
}
