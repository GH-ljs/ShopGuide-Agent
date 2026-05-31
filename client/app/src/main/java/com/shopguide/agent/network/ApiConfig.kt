package com.shopguide.agent.network

/**
 * Android 模拟器访问电脑本机服务时，不能使用 localhost，需要使用 10.0.2.2。
 */
object ApiConfig {
//    模拟机
//    const val BASE_URL = "http://10.0.2.2:3001"
//    真机
    const val BASE_URL = "http://192.168.1.102:3001"
}
