package com.capyworkclock.timer;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BuildConfigurationTest {

    @Test
    public void releaseIdentityIsStable() {
        assertEquals("com.capyworkclock.timer", BuildConfig.APPLICATION_ID);
        assertEquals("1.0.0", BuildConfig.VERSION_NAME);
        assertTrue(BuildConfig.VERSION_CODE > 0);
    }
}
