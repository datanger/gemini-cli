% 主脚本 - 入口点
function main()
    % 调用其他函数
    result1 = calculate_sum(10, 20);
    result2 = process_data([1, 2, 3, 4, 5]);
    
    % 调用其他脚本中的函数
    display_result(result1);
    plot_data(result2);
    
    % 调用工具函数
    utils = create_utils();
    utils.print_info('Main script completed');
end

function result = calculate_sum(a, b)
    result = a + b;
end

function data = process_data(input_data)
    data = input_data * 2;
end 